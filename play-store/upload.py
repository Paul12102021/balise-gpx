# Envoi de la fiche Play Store (descriptions + captures pour téléphone) par l'API Google Play.
# Lancé par l'action GitHub « Fiche Play Store » (bouton Run workflow) ; clé : secret PLAY_SERVICE_ACCOUNT_JSON.
# Dossiers : play-store/<langue>/short.txt, full.txt, 1.jpg … 8.jpg (ordre d'affichage).
# Le titre de la fiche n'est pas touché. Les langues sont associées à celles déjà présentes sur la fiche (fr → fr-FR…).
import json, os, sys, glob
from google.oauth2 import service_account
from googleapiclient.discovery import build
from googleapiclient.http import MediaFileUpload

PKG = 'fr.pisteo.app'
HERE = os.path.dirname(os.path.abspath(__file__))
DEFAULT = {'fr': 'fr-FR', 'en': 'en-US', 'es': 'es-ES'}
only_text = '--texte' in sys.argv

creds = service_account.Credentials.from_service_account_info(
    json.loads(os.environ['PLAY_JSON']), scopes=['https://www.googleapis.com/auth/androidpublisher'])
api = build('androidpublisher', 'v3', credentials=creds, cache_discovery=False)
edits = api.edits()
eid = edits.insert(packageName=PKG, body={}).execute()['id']
have = {l['language']: l for l in edits.listings().list(packageName=PKG, editId=eid).execute().get('listings', [])}
print('Langues de la fiche :', ', '.join(sorted(have)) or 'aucune')

for d in sorted(os.listdir(HERE)):
    folder = os.path.join(HERE, d)
    if not os.path.isdir(folder):
        continue
    lang = next((k for k in have if k.split('-')[0] == d), DEFAULT.get(d, d))
    short = open(os.path.join(folder, 'short.txt'), encoding='utf-8').read().strip()
    full = open(os.path.join(folder, 'full.txt'), encoding='utf-8').read().strip()
    body = {'language': lang, 'shortDescription': short, 'fullDescription': full}
    if lang in have:
        edits.listings().patch(packageName=PKG, editId=eid, language=lang, body=body).execute()
    else:  # nouvelle langue : il faut un titre
        body['title'] = next(iter(have.values()))['title'] if have else 'Pisteo'
        edits.listings().update(packageName=PKG, editId=eid, language=lang, body=body).execute()
    print(f'{lang} : descriptions envoyées ({len(short)} / {len(full)} caractères)')
    if only_text:
        continue
    imgs = sorted(glob.glob(os.path.join(folder, '*.jpg')) + glob.glob(os.path.join(folder, '*.png')),
                  key=lambda p: int(os.path.splitext(os.path.basename(p))[0]))
    if not imgs:
        continue
    edits.images().deleteall(packageName=PKG, editId=eid, language=lang, imageType='phoneScreenshots').execute()
    for p in imgs:
        mime = 'image/png' if p.endswith('.png') else 'image/jpeg'
        edits.images().upload(packageName=PKG, editId=eid, language=lang, imageType='phoneScreenshots',
                              media_body=MediaFileUpload(p, mimetype=mime)).execute()
    print(f'{lang} : {len(imgs)} captures envoyées')

# appli encore en test fermé : la fiche est validée sans attendre une nouvelle version
res = edits.commit(packageName=PKG, editId=eid, changesNotSentForReview=False).execute()
print('Fiche enregistrée, envoyée à l\'examen de Google :', res.get('id'))

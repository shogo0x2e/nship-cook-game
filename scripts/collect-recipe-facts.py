"""Read the selected publishers' recipe facts/photos; write a local provenance manifest."""
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.parse import urljoin
from concurrent.futures import ThreadPoolExecutor
import json, re, hashlib, io
from bs4 import BeautifulSoup
from PIL import Image
SOURCES={
 'curry':'https://housefoods.jp/recipe/rcp_00027252.html',
 'nikujaga':'https://www.kikkoman.co.jp/homecook/washoku/031/',
 'hamburger':'https://www.kikkoman.co.jp/homecook/search/recipe/00004695/',
 'oyakodon':'https://www.kikkoman.co.jp/homecook/search/recipe/00004703/',
 'fried-rice':'https://www.kikkoman.co.jp/homecook/search/recipe/00005454/',
 'yakisoba':'https://www.kikkoman.co.jp/homecook/search/recipe/00050997/',
 'yakiudon':'https://www.kikkoman.co.jp/homecook/search/recipe/00006099/',
 'salmon-foil':'https://www.kikkoman.co.jp/homecook/search/recipe/00055959/',
 'salmon-cabbage':'https://www.marukome.co.jp/recipe/detail/ekimiso_243/',
 'egg-sandwich':'https://www.kewpie.co.jp/recipes/recipe/QP00013780/',
 'chicken-tomato':'https://www.kikkoman.co.jp/homecook/search/recipe/00007359/',
 'pizza-toast':'https://www.orangepage.net/recipes/122591',
}
CACHE=Path('/private/tmp/cookgame-source-cache'); CACHE.mkdir(exist_ok=True)
OUT=Path('public/experience/assets');OUT.mkdir(parents=True,exist_ok=True)
def request(url):
 with urlopen(Request(url,headers={'User-Agent':'Mozilla/5.0 (compatible; recipe-source-verification)'}),timeout=30) as r:return r.read()
def objects(value):
 if isinstance(value,list):
  for v in value:yield from objects(v)
 elif isinstance(value,dict):
  yield value
  if '@graph' in value:yield from objects(value['@graph'])
def collect(item):
 id,url=item;raw=request(url);(CACHE/(id+'.html')).write_bytes(raw);soup=BeautifulSoup(raw,'html.parser');recipe={}
 for tag in soup.find_all('script',type='application/ld+json'):
  try:
   for obj in objects(json.loads(tag.string or tag.get_text())):
    if obj.get('@type')=='Recipe' or isinstance(obj.get('@type'),list) and 'Recipe' in obj['@type']:recipe=obj
  except (ValueError,TypeError):pass
 image=recipe.get('image');image=image[0] if isinstance(image,list) else image
 if isinstance(image,dict):image=image.get('url')
 if not image:
  og=soup.find('meta',property='og:image');image=og.get('content') if og else None
 if id=='nikujaga':
  candidates=[img for img in soup.find_all('img') if any(t in str(img.get('src','')) for t in ['main','mv','mainvisual']) and '/031/' in str(img.get('src',''))]
  if candidates:image=candidates[0].get('src')
 if not image:raise ValueError('No photo for '+id)
 image=urljoin(url,image);photo=request(image);im=Image.open(io.BytesIO(photo)).convert('RGB');original=im.size;im.thumbnail((1120,840));out=OUT/(id+'.webp');im.save(out,'WEBP',quality=87,method=6)
 text=soup.get_text('\n',strip=True);(CACHE/(id+'.txt')).write_text(text)
 record={'id':id,'source':url,'photoUrl':image,'originalDimensions':original,'photoSha256':hashlib.sha256(photo).hexdigest(),'localFile':'/experience/assets/'+out.name,'facts':{k:recipe.get(k) for k in ['name','recipeYield','totalTime','cookTime','recipeIngredient','recipeInstructions']}}
 return record
if __name__=='__main__':
 rows=[]
 with ThreadPoolExecutor(max_workers=4) as pool:
  for record in pool.map(collect,SOURCES.items()):
   rows.append(record);print(record['id'],json.dumps(record['facts'],ensure_ascii=False))
 (OUT/'photo-sources.json').write_text(json.dumps(rows,ensure_ascii=False,indent=2)+'\n')

"""从已下载的OFL文渊圆体v1.100构建静态字体；保留BMP字形，改名并压成WOFF2。"""
from pathlib import Path
import shutil
from fontTools.ttLib import TTFont
from fontTools import subset
from fontTools.varLib.instancer import instantiateVariableFont

root=Path(__file__).resolve().parents[1]
source=root/'output/pet-reference-font/WenYuanRoundedSCVF.ttf'
dest=root/'src/renderer/public/pet-skins'
font=TTFont(source)
options=subset.Options();options.name_IDs=['*'];options.name_languages=['*'];options.notdef_glyph=True
sub=subset.Subsetter(options=options)
sub.populate(unicodes=[u for u in font.getBestCmap() if u<=0xffff])
sub.subset(font)
instantiateVariableFont(font,{'wght':850,'ital':0},inplace=True)
names={1:'Zhiliao Pet Round',2:'Bold',3:'ZhiliaoPetRound-1.100-Bold-BMP',4:'Zhiliao Pet Round Bold',6:'ZhiliaoPetRound-Bold',16:'Zhiliao Pet Round',17:'Bold'}
for record in font['name'].names:
    if record.nameID in names:record.string=names[record.nameID].encode(record.getEncoding(),errors='replace')
font.flavor='woff2'
font.save(dest/'pet-round-cjk.woff2')
shutil.copyfile(source.parent/'LICENSE.md',dest/'PetRound-OFL.md')
(dest/'PetRound-SOURCE.txt').write_text('Zhiliao Pet Round is a renamed, static weight-850, upright BMP subset of WenYuan Rounded SC VF v1.100.\nUpstream: https://github.com/takushun-wu/WenYuanFonts/releases/tag/v1.100\nOriginal file: WenYuanRoundedSCVF.ttf\nCopyright remains with the upstream authors; see PetRound-OFL.md.\nBuild: tools/build-pet-round-font.py (fontTools); no outline edits.\n',encoding='utf-8')
print('PET ROUND FONT:',(dest/'pet-round-cjk.woff2').stat().st_size,'bytes;',len(font.getBestCmap()),'glyphs')

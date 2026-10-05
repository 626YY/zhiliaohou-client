"""把认可原稿接成可复用SVG图层。只读PNG像素生成裁切路径，原稿文件逐字节复制，不重画动物。

SVG保留原稿的轮廓/纸感/配色，用同稿空白纹理覆盖可编辑文字与礼物区。
尾巴、心心、吊饰使用同一份原PNG加SVG裁切，运行时可独立运动。
"""
import base64
import hashlib
import json
from pathlib import Path
import shutil

import cv2
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT.parent / 'output/timer-skins-20260920/suites'
DEST = ROOT / 'src/renderer/public/pet-skins'

# 区域均为原稿1254坐标；多边形走在墨线外的背景里，不能切穿尾巴轮廓。
# bodyEdge沿身体与卷尾之间的负形分离图层；不能用一条水平切线切穿背部墨线。
SPECS = {
    'duo': dict(file='02-mint-duo.png', clock=[400,736], side='left', anchor=[143,716],
        charm=[[(101,690),(148,685),(181,715),(184,749),(156,752),(155,792),(170,812),(177,841),(162,861),(141,868),(122,902),(97,908),(78,886),(64,878),(64,850),(98,823),(98,816),(68,827),(45,810),(43,776),(56,748),(104,733)]],
        tails=[dict(pivot=[365,386], polygon=[(221,281),(286,272),(328,311),(343,324),(380,318),(389,403),(363,412),(241,408),(218,365)], cut=393,bodyRight=369),
               dict(pivot=[968,402], polygon=[(952,376),(988,347),(1013,308),(1051,308),(1079,331),(1088,375),(1071,422),(1037,432),(963,417)],cut=403,bodyLeft=968,joinY=370)],
        heart=[560,66,720,142], marks=[[178,266,239,351],[1044,260,1118,329]], transparentGaps=[([300,270,380,348],[347,310])], menu='#edfbe5', line='#bee7bd'),
    'cream': dict(file='01-cream-puppy.png',clock=[401,737],side='right',anchor=[1106,703],
        charm=[[(1081,681),(1117,674),(1145,685),(1148,711),(1130,722),(1145,740),(1175,733),(1199,751),(1199,781),(1178,800),(1154,796),(1142,782),(1132,790),(1155,807),(1156,829),(1139,846),(1120,842),(1102,830),(1080,830),(1062,814),(1058,788),(1074,771),(1091,764),(1091,739),(1071,723),(1066,702)]],
        tails=[dict(pivot=[866,383], polygon=[(850,315),(875,300),(870,245),(925,230),(995,245),(1015,330),(990,395),(870,410),(850,360)],cut=398,bodyEdge=[(0,866),(1254,866)],overlapY=[330,352],frameEdge=[(0,1254),(377,960),(386,948),(399,960),(1254,960)])],
        heart=[255,218,365,345],marks=[[986,238,1040,306]],menu='#fff5dc',line='#f5e5bc'),
    'peach':dict(file='03-peach-kitten.png',clock=[400,737],side='right',anchor=[1114,752],
        charm=[[(1090,682),(1117,677),(1140,698),(1145,732),(1174,735),(1186,757),(1182,779),(1198,801),(1196,831),(1166,851),(1153,871),(1175,889),(1184,920),(1177,938),(1193,955),(1188,972),(1208,985),(1209,1007),(1189,1021),(1167,1010),(1154,989),(1136,978),(1134,958),(1122,943),(1128,924),(1115,912),(1117,887),(1117,859),(1093,849),(1082,830),(1080,799),(1083,776),(1079,752),(1095,737),(1096,708)]],
        tails=[dict(pivot=[888,389],polygon=[(836,335),(854,309),(855,277),(878,250),(921,248),(970,240),(1015,285),(1025,345),(1008,401),(961,421),(868,410)],cut=398,bodyEdge=[(0,875),(330,875),(350,885),(360,891),(376,886),(1254,886)],frameEdge=[(0,1254),(378,991),(390,980),(399,965),(421,938),(1254,938)],pad=8)],
        heart=[261,207,355,305],marks=[[980,236,1063,303],[1182,830,1228,900]],transparentGaps=[([810,245,932,380],[878,318])],menu='#ffede4',line='#ffd1c4'),
    'night':dict(file='04-goodnight-cat.png',clock=[392,739],side='left',anchor=[141,488],
        charm=[[(119,462),(148,461),(176,481),(181,506),(164,519),(168,557),(156,581),(176,584),(194,575),(197,599),(179,625),(155,642),(148,675),(166,689),(167,709),(148,722),(142,738),(121,741),(103,724),(79,723),(75,702),(89,684),(108,675),(111,635),(88,622),(75,600),(72,566),(83,535),(107,518),(114,506),(110,485)]],
        tails=[dict(pivot=[926,394],polygon=[(847,327),(867,303),(894,305),(909,319),(939,321),(939,307),(921,293),(923,273),(944,257),(976,254),(1008,263),(1035,285),(1057,321),(1073,351),(1062,394),(1034,421),(894,412)],cut=402,bodyEdge=[(0,915),(320,915),(345,930),(365,930),(385,920),(1254,920)],frameEdge=[(0,1254),(385,1060),(402,1044),(421,1012),(1254,1012)],pad=8)],
        heart=[262,138,382,259],marks=[[1020,246,1107,311]],transparentGaps=[([810,240,986,380],[923,337])],menu='#595d80',line='#8c80af'),
}

def polygon_mask(points, shape=(1254,1254)):
    mask=np.zeros(shape,np.uint8)
    cv2.fillPoly(mask,[np.array(points,np.int32)],255)
    return mask

def box_mask(box):
    x0,y0,x1,y1=box
    return polygon_mask([(x0,y0),(x1,y0),(x1,y1),(x0,y1)])

def svg_path(mask):
    contours,_=cv2.findContours(mask,cv2.RETR_LIST,cv2.CHAIN_APPROX_SIMPLE)
    paths=[]
    for contour in contours:
        if cv2.contourArea(contour)<2:continue
        points=cv2.approxPolyDP(contour,.45,True)[:,0,:]
        paths.append('M'+'L'.join(f'{x},{y}' for x,y in points)+'Z')
    return ''.join(paths)

def bounds(mask):
    ys,xs=np.where(mask>0)
    return [int(xs.min()),int(ys.min()),int(xs.max()+1),int(ys.max()+1)]

metadata={}
for key,spec in SPECS.items():
    source=SOURCE/spec['file']
    if not source.exists():source=DEST/f'reference-{key}.png'
    raw=np.asarray(Image.open(source).convert('RGB'))
    # 暖白背景不入轮廓；封闭的动物白毛、白骨头、卡片内部全部保留。
    foreground=(raw.min(axis=2)<210).astype(np.uint8)*255
    # 原稿笔触有刻意断口；先闭合断口以找内部，再保留原来的外侧墨线。
    closed=cv2.morphologyEx(foreground,cv2.MORPH_CLOSE,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(25,25)))
    contours,_=cv2.findContours(closed,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    silhouette=np.zeros(foreground.shape,np.uint8)
    for contour in contours:
        if cv2.contourArea(contour)>12:cv2.drawContours(silhouette,[contour],0,255,-1)
    silhouette=cv2.bitwise_or(foreground,cv2.bitwise_and(silhouette,cv2.bitwise_not(closed)))
    contours,_=cv2.findContours(silhouette,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    cv2.drawContours(silhouette,contours,-1,255,-1)
    # 心心与头顶之间的原稿纸底必须透明，不能在分层后变成一块白色贴纸。
    r,g,b=raw[:,:,0].astype(float),raw[:,:,1].astype(float),raw[:,:,2].astype(float)
    paper=(r>235)&(g>232)&(b>220)&(r-b>3)&(np.abs(r-g)<12)
    hx0,hy0,hx1,hy1=spec['heart']
    near_heart=box_mask([max(0,hx0-10),max(0,hy0-10),hx1+10,hy1+20])>0
    silhouette[paper&near_heart]=0
    # 尾巴和身体之间的亮色负形是原稿纸底，不是白毛；按原图墨线边界清除指定空隙。
    for box,seed in spec.get('transparentGaps',[]):
        bright=((raw.min(axis=2)>210)&(box_mask(box)>0)).astype(np.uint8)
        if bright[seed[1],seed[0]]:
            cv2.floodFill(bright,None,tuple(seed),2)
            silhouette[bright==2]=0
    # 动感短线必须是独立的小连通块；不能把相邻尾巴轮廓一起裁进短线图层。
    count,labels,stats,_=cv2.connectedComponentsWithStats(foreground,8)
    mark_masks=[];mark_clear=np.zeros_like(silhouette)
    for x0,y0,x1,y1 in spec['marks']:
        mark=np.zeros_like(silhouette)
        for label in range(1,count):
            x,y,w,h,area=stats[label]
            if 12<=area<6000 and w<110 and h<140 and x<x1 and y<y1 and x+w>x0 and y+h>y0:
                mark[labels==label]=255
                mark_clear=cv2.bitwise_or(mark_clear,box_mask([max(0,x-2),max(0,y-2),x+w+2,y+h+2]))
        if not np.any(mark):raise RuntimeError(f'{key}: empty motion marks')
        mark_masks.append(mark)
    all_marks=np.maximum.reduce(mark_masks)
    main=silhouette.copy()
    charm_region=np.maximum.reduce([polygon_mask(p) for p in spec['charm']])
    charm=cv2.bitwise_and(silhouette,charm_region)
    if key=='night':
        # 月牙开口里看到的是蓝色计时牌，不能连同月牙一起裁成会移动的蓝色贴片。
        warm=((r>b*1.10)&(r>=g))|((r<50)&(g<50)&(b<50))|((r>245)&(g>245)&(b>245))
        charm=cv2.bitwise_and(charm,warm.astype(np.uint8)*255)
    charm_clear=cv2.dilate(charm_region,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(7,7)))
    main[charm_clear>0]=0
    layers=[]
    for i,tail in enumerate(spec['tails']):
        pad=tail.get('pad',3)
        region=cv2.dilate(polygon_mask(tail['polygon']),cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(pad*2+1,pad*2+1)))
        mask=cv2.bitwise_and(silhouette,region)
        mask[all_marks>0]=0
        join_y=tail.get('joinY',0)
        if 'bodyRight' in tail:mask[join_y:,tail['bodyRight']+16:]=0
        if 'bodyLeft' in tail:mask[join_y:,:tail['bodyLeft']-16]=0
        # 自由尾巴区域从底图完整移除；不能沿外缘保留一圈墨线，否则摆动时会露出旧轮廓。
        # 重叠仅留在根部/框沿，动态层仍绘制完整尾巴。
        remove=region.copy();remove[tail['cut']:,:]=0
        if 'bodyRight' in tail:remove[join_y:,tail['bodyRight']:]=0
        if 'bodyLeft' in tail:remove[join_y:,:tail['bodyLeft']]=0
        if 'bodyEdge' in tail:
            edge=np.array(tail['bodyEdge'])
            boundary=np.interp(np.arange(1254),edge[:,0],edge[:,1]).round().astype(int)
            for y,x in enumerate(boundary):
                remove[y,:x]=0
                # 重叠只藏在低处的实心根部，不能把背部上沿也带进动态层。
                start,end=tail.get('overlapY',[350,382])
                overlap=round(np.clip((y-start)/(end-start),0,1)*16)
                mask[y,:x-overlap]=0
        if 'frameEdge' in tail:
            # 尾巴与卡片相接后，向右延伸的是固定框线，不能随尾巴一起转出来。
            edge=np.array(tail['frameEdge'])
            for y,x in enumerate(np.interp(np.arange(1254),edge[:,0],edge[:,1]).round().astype(int)):
                mask[y,x:]=0
        main[remove>0]=0
        layers.append(dict(kind='tail',path=svg_path(mask),bounds=bounds(mask),pivot=tail['pivot'],delay=i*.2))
    for i,(kind,box) in enumerate([('heart',spec['heart']),* [('tail-lines',b) for b in spec['marks']]]):
        region=box_mask(box)
        mask=cv2.bitwise_and(silhouette,region)
        if kind=='heart':
            r,g,b=raw[:,:,0].astype(float),raw[:,:,1].astype(float),raw[:,:,2].astype(float)
            color=((b>r*1.05)&(b>g*1.15)&(b>100)) if key=='night' else ((r>200)&(r>g*1.10)&(r>b*1.07)&(g<b*1.05))
            weak=((b-r>4)&(b-g>6)&(b>100)) if key=='night' else ((r>200)&(r-g>5)&(b-g>-6))
            count_h,labels_h,stats_h,_=cv2.connectedComponentsWithStats(cv2.bitwise_and(region,weak.astype(np.uint8)*255),8)
            mask=np.zeros_like(silhouette)
            for label in range(1,count_h):
                component=labels_h==label
                if stats_h[label,cv2.CC_STAT_AREA]>=12 and np.any(component&color):mask[component]=255
            mask=cv2.morphologyEx(mask,cv2.MORPH_CLOSE,np.ones((3,3),np.uint8))
            contours,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
            cv2.drawContours(mask,contours,-1,255,-1)
            for contour in contours:
                x,y,w,h=cv2.boundingRect(contour)
                main[box_mask([x-1,y-1,x+w+1,y+h+1])>0]=0
        else:mask=mark_masks[i-1]
        main[mask>0]=0
        layers.append(dict(kind=kind,path=svg_path(mask),bounds=bounds(mask),pivot=[(box[0]+box[2])/2,(box[1]+box[3])/2],delay=i*.15))
    main[mark_clear>0]=0
    # 用同稿另一侧的干净边框补齐被吊饰遮住的窄条，杜绝骨头被当成菜单背景拉长。
    charm_bottom=bounds(charm)[3]+12
    repair=[120,max(430,spec['anchor'][1]-40),205,charm_bottom] if spec['side']=='left' else [1049,max(430,spec['anchor'][1]-40),1134,charm_bottom]
    repair_region=box_mask(repair)>0
    mirrored=np.fliplr(silhouette)
    main[repair_region]=mirrored[repair_region]
    # 清除原稿中的文字/礼物，只在可编辑区覆盖同一张图的空白纹理。
    encoded=base64.b64encode(source.read_bytes()).decode('ascii')
    defs=f'<image id="art" width="1254" height="1254" href="data:image/png;base64,{encoded}"/>'
    defs+=f'<clipPath id="outer"><path d="{svg_path(main)}"/></clipPath>'
    defs+=f'<clipPath id="edgeRepair"><rect x="{repair[0]}" y="{repair[1]}" width="{repair[2]-repair[0]}" height="{repair[3]-repair[1]}"/></clipPath>'
    protected_inner=cv2.erode(silhouette,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(43,43)))
    defs+=f'<clipPath id="editable"><path d="{svg_path(protected_inner)}"/></clipPath>'
    # 原稿左边框内有完整的空白纹理；横向平铺，保留从上到下的柔和色差。
    for name,y,h in [('title',437,91),('time',530,152),('menu',739,402)]:
        sample=(380,y,16,h) if name=='title' else (590,742,16,170) if name=='menu' else (1011,y,8,h)
        defs+=f'<pattern id="{name}" patternUnits="userSpaceOnUse" x="0" y="{y}" width="1254" height="{h}" viewBox="{sample[0]} {sample[1]} {sample[2]} {sample[3]}" preserveAspectRatio="none"><use href="#art"/></pattern>'
    ink='#302115' if key!='night' else '#0b0907'
    patches='<rect x="403" y="438" width="450" height="89" fill="url(#title)"/>'
    patches+='<rect x="211" y="530" width="810" height="152" fill="url(#time)"/>'
    if key=='night':
        top=raw[438:443,895:905].mean(axis=(0,1)).round().astype(int)
        bottom=raw[672:679,1009:1019].mean(axis=(0,1)).round().astype(int)
        rgb=lambda c:'rgb('+','.join(map(str,c))+')'
        defs+=f'<linearGradient id="nightClock" gradientUnits="userSpaceOnUse" x1="0" y1="437" x2="0" y2="690"><stop stop-color="{rgb(top)}"/><stop offset="1" stop-color="{rgb(bottom)}"/></linearGradient>'
        defs+='<filter id="softEdge"><feGaussianBlur stdDeviation="2"/></filter><mask id="nightClockArea" maskUnits="userSpaceOnUse" x="0" y="0" width="1254" height="1254"><rect x="160" y="437" width="944" height="253" fill="white" filter="url(#softEdge)"/></mask>'
        patches='<rect width="1254" height="1254" fill="url(#nightClock)" mask="url(#nightClockArea)"/>'
        stars=np.zeros_like(silhouette)
        yellow=(r>180)&(g>145)&(b<210)&(r>b*1.15)
        for box in [[239,446,291,507],[204,515,236,545],[1020,494,1076,555],[1052,559,1088,596]]:
            stars=cv2.bitwise_or(stars,cv2.bitwise_and(box_mask(box),yellow.astype(np.uint8)*255))
        defs+=f'<clipPath id="nightStars"><path d="{svg_path(stars)}"/></clipPath>'
        patches+='<use href="#art" clip-path="url(#nightStars)"/>'
    patches+='<rect x="182" y="739" width="892" height="390" rx="24" fill="url(#menu)"/>'
    # 细线位于菜单中央，覆盖范围之外的尾端也清掉。
    patches+='<rect x="180" y="905" width="896" height="46" fill="url(#menu)"/>'
    repaired='<g clip-path="url(#edgeRepair)"><use href="#art" transform="translate(1254 0) scale(-1 1)"/></g>'
    body=f'<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1254" height="1254" viewBox="0 0 1254 1254" preserveAspectRatio="none"><defs>{defs}</defs><g clip-path="url(#outer)"><use href="#art"/>{repaired}<g clip-path="url(#editable)">{patches}</g></g></svg>'
    target=DEST/f'reference-{key}.svg';target.write_text(body,encoding='utf-8')
    (DEST/f'reference-{key}.mask.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="1254" height="1254" viewBox="0 0 1254 1254" preserveAspectRatio="none"><path d="{svg_path(main)}" fill="white"/></svg>',encoding='utf-8')
    # 菜单内遮罩只根据原框体轮廓，防止自定义底色/分隔线越过手绘描边。
    inner=cv2.erode(silhouette,cv2.getStructuringElement(cv2.MORPH_ELLIPSE,(51,51)))
    inner[:spec['clock'][1],:]=0;inner[:,:160]=0;inner[:,1090:]=0
    (DEST/f'reference-{key}.inner.svg').write_text(f'<svg xmlns="http://www.w3.org/2000/svg" width="1254" height="1254" viewBox="0 0 1254 1254" preserveAspectRatio="none"><path d="{svg_path(inner)}" fill="white"/></svg>',encoding='utf-8')
    png=DEST/f'reference-{key}.png'
    if source.resolve()!=png.resolve():shutil.copyfile(source,png)
    assert hashlib.sha256(source.read_bytes()).digest()==hashlib.sha256(png.read_bytes()).digest()
    metadata['pet_'+key]=dict(key=key,clock=spec['clock'],side=spec['side'],anchor=spec['anchor'],charm=dict(path=svg_path(charm),bounds=bounds(charm)),layers=layers,sourceSha256=hashlib.sha256(source.read_bytes()).hexdigest())
    print(key,'original PNG unchanged;',len(layers),'motion layers;', 'charm bounds',bounds(charm))

module='// 由 tools/gen-pet-reference-art.py 从认可原稿生成；路径使用原稿像素坐标。\nexport const PET_REFERENCE_ART = '+json.dumps(metadata,ensure_ascii=False,separators=(',',':'))+' as const\n'
(ROOT/'src/shared/petReferenceArt.ts').write_text(module,encoding='utf-8')

"""从原画 alpha 连通区域生成 SVG 裁切路径，PNG 原图保持不变。仅在替换皮肤素材后运行。"""
from collections import deque
from pathlib import Path
from PIL import Image

folder=Path(__file__).resolve().parents[1]/'src/renderer/public/pet-skins'
for source in sorted(folder.glob('frame-*.png')):
    image=Image.open(source).convert('RGBA')
    w,h=image.size
    alpha=image.getchannel('A').tobytes()
    seed=(h*3//4)*w+w//2
    if alpha[seed]<64:raise RuntimeError('Expected opaque card center: '+source.name)
    visited=bytearray(w*h)
    queue=deque([seed]);visited[seed]=1
    left=[w]*h;right=[-1]*h
    while queue:
        pixel=queue.popleft();y,x=divmod(pixel,w)
        left[y]=min(left[y],x);right[y]=max(right[y],x)
        for other,valid in ((pixel-1,x>0),(pixel+1,x<w-1),(pixel-w,y>0),(pixel+w,y<h-1)):
            if valid and not visited[other] and alpha[other]>=64:
                visited[other]=1;queue.append(other)
    rows=[y for y in range(h) if right[y]>=0]
    points=[(left[y],y) for y in rows]+[(right[y],y) for y in reversed(rows)]
    simple=[]
    for point in points:
        while len(simple)>1:
            a,b=simple[-2:]
            if (b[0]-a[0])*(point[1]-b[1])!=(b[1]-a[1])*(point[0]-b[0]):break
            simple.pop()
        simple.append(point)
    contour='M'+'L'.join(f'{x} {y}' for x,y in simple)+'Z'
    svg=f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" preserveAspectRatio="none"><path d="{contour}" fill="white" stroke="white" stroke-width="8" stroke-linejoin="round"/></svg>\n'
    source.with_suffix('.mask.svg').write_text(svg,encoding='utf-8')
    print(source.stem,'SVG clip generated',len(simple),'points')

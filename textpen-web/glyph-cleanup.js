'use strict';

// Work on stored paths in the drawing pad's 600 × 300 coordinates.
// Kept paths are never reshaped. New arrays also invalidate the Path2D cache.
const GlyphCleanup = (() => {
  const box = points => {
    const b={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
    for(const [x,y] of points){b.minX=Math.min(b.minX,x);b.maxX=Math.max(b.maxX,x);b.minY=Math.min(b.minY,y);b.maxY=Math.max(b.maxY,y);}
    b.size=Math.max(b.maxX-b.minX,b.maxY-b.minY);
    return b;
  };
  const boxGap=(a,b)=>Math.hypot(Math.max(0,a.minX-b.maxX,b.minX-a.maxX),Math.max(0,a.minY-b.maxY,b.minY-a.maxY));
  function pointDistance(p,a,b){
    const dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
    const t=length?Math.max(0,Math.min(1,((p[0]-a[0])*dx+(p[1]-a[1])*dy)/length)):0;
    return Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy);
  }
  const cross=(a,b,c)=>(b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
  function segmentDistance(a,b,c,d){
    const ac=cross(a,b,c),ad=cross(a,b,d),ca=cross(c,d,a),cb=cross(c,d,b);
    if(((ac>0&&ad<0)||(ac<0&&ad>0))&&((ca>0&&cb<0)||(ca<0&&cb>0)))return 0;
    return Math.min(pointDistance(a,c,d),pointDistance(b,c,d),pointDistance(c,a,b),pointDistance(d,a,b));
  }
  function nearby(a,b,radius){
    for(let i=0;i<Math.max(1,a.length-1);i++)for(let j=0;j<Math.max(1,b.length-1);j++){
      if(segmentDistance(a[i],a[Math.min(i+1,a.length-1)],b[j],b[Math.min(j+1,b.length-1)])<=radius)return true;
    }
    return false;
  }
  function clean(character,strokes){
    const normalized=character.normalize('NFD');
    if(!/^[\p{L}\p{N}][\p{M}]*$/u.test(normalized)||strokes.length<2)return strokes;
    const boxes=strokes.map(box),main=boxes.reduce((a,b)=>b.size>a.size?b:a);
    if(main.size<20)return strokes;
    // Extent, rather than accumulated pen travel: a scribbled speck is still a speck.
    const small=b=>b.size<=Math.min(48,main.size*.38);
    const keep=new Set(boxes.flatMap((b,i)=>!small(b)?[i]:[]));
    const body=box([...keep].flatMap(i=>strokes[i]));
    const base=Array.from(normalized)[0],marks=normalized.slice(base.length);
    const otherScript=/\p{L}/u.test(base)&&!/\p{Script=Latin}/u.test(base);
    const below=/[\u0316-\u0333\u0345]/u.test(marks);
    const above=/[\u0300-\u0315\u033d-\u0344\u0346-\u036f]/u.test(marks)||base==='i'||base==='j';
    const margin=Math.max(12,Math.min(24,main.size*.25));
    const reach=Math.max(24,Math.min(65,main.size*.65));
    // Real letter parts (a t-bar or E-arm drawn with a small gap) are more than a speck and sit on the body.
    const part=Math.max(12,main.size*.15);
    boxes.forEach((b,i)=>{
      const aligned=b.maxX>=body.minX-margin&&b.minX<=body.maxX+margin;
      if(b.size>=part&&aligned&&b.maxY>=body.minY-margin&&b.minY<=body.maxY+margin){keep.add(i);return;}
      // Only letters which actually have marks get an accent zone, with a bounded distance.
      // Other scripts can have semantic detached marks above or below the body.
      if(aligned&&(((above||otherScript)&&b.maxY<body.minY&&body.minY-b.maxY<=reach)||
        ((below||otherScript)&&b.minY>body.maxY&&b.minY-body.maxY<=reach)))keep.add(i);
    });
    // Compare actual segments, not their enclosing rectangles (e.g. inside C or U).
    // Extend connected pieces transitively to retain crossbars and multi-stroke joins.
    let changed=true;
    while(changed){
      changed=false;
      boxes.forEach((b,i)=>{
        if(keep.has(i))return;
        const radius=b.size<=5?5:Math.max(6,Math.min(12,main.size*.12));
        if([...keep].some(j=>boxGap(b,boxes[j])<=radius&&nearby(strokes[i],strokes[j],radius))){keep.add(i);changed=true;}
      });
    }
    return keep.size===strokes.length?strokes:strokes.filter((_,i)=>keep.has(i));
  }
  return {clean};
})();

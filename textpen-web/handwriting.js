'use strict';
const Handwriting = {
  // Original vector geometry from Unbenanntes Notizbuch.pdf, pages 1–6.
  // All dimensions are PDF points (1/72 inch), never scaled with page size.
  papers:{
    lined:{page:1,start:50,step:17.5,bottom:21.39},
    grid:{page:2,start:15.5,step:16,bottom:0,vertical:15.5},
    wide:{page:3,start:49.5,step:25,bottom:16.89},
    college:{page:4,start:50,step:16,bottom:23.39,redMargin:64},
    dots:{page:5,start:0,step:16,bottom:0,dots:true},
    plain:{page:6}
  },
  paintPaper(ctx,type,width,height){
    const p=this.papers[type];if(!p||!p.step)return;
    const k=96/72,w=width/k,h=height/k;
    // PDF geometry stays in physical units, without screen-pixel snapping.
    if(ctx.vector){
      ctx.save();ctx.fillStyle='#c5c9cd';
      if(p.dots){for(let y=0;y<=h;y+=16)for(let x=0;x<=w;x+=16){ctx.beginPath();ctx.arc(x*k,y*k,.5*k,0,Math.PI*2);ctx.fill();}}
      else{
        for(let y=p.start;y+.5<=h-p.bottom+.001;y+=p.step)ctx.fillRect(0,y*k,width,.5*k);
        if(p.vertical!==undefined)for(let x=p.vertical;x+.5<=w;x+=p.step)ctx.fillRect(x*k,0,.5*k,height);
        if(p.redMargin!==undefined){ctx.fillStyle='#c13343';ctx.fillRect(p.redMargin*k,0,.5*k,height);}
      }
      ctx.restore();return;
    }
    const {a:sx,d:sy}=ctx.getTransform();
    // Align every rule to whole backing-store pixels, with identical thickness.
    const lineX=Math.max(1,Math.round(.5*k*sx)),lineY=Math.max(1,Math.round(.5*k*sy));
    ctx.save();ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#c5c9cd';
    if(p.dots){for(let y=0;y<=h;y+=16)for(let x=0;x<=w;x+=16){ctx.beginPath();ctx.arc(Math.round(x*k*sx),Math.round(y*k*sy),Math.max(.7,.5*k*Math.min(sx,sy)),0,Math.PI*2);ctx.fill();}}
    else{
      for(let y=p.start;y+.5<=h-p.bottom+.001;y+=p.step)ctx.fillRect(0,Math.round(y*k*sy),Math.round(width*sx),lineY);
      if(p.vertical!==undefined)for(let x=p.vertical;x+.5<=w;x+=p.step)ctx.fillRect(Math.round(x*k*sx),0,lineX,Math.round(height*sy));
      if(p.redMargin!==undefined){ctx.fillStyle='#c13343';ctx.fillRect(Math.round(p.redMargin*k*sx),0,lineX,Math.round(height*sy));}
    }
    ctx.restore();
  },
  paperLayout(type,width,height,size,spacing,marginMm,rows=1){
    const margin=Math.min(marginMm*96/25.4,width/3,height/3),p=this.papers[type];
    const unit=p?.step? p.step*96/72:0,first=p?.step?(p.start+(p.dots?0:.25))*96/72:0;
    const left=p?.redMargin?Math.max(margin,(p.redMargin+10)*96/72):margin;
    const ruled=['lined','wide','college','grid'].includes(type);
    const span=Math.max(1,Math.min(5,Math.round(rows)||1));
    const leading=ruled?unit*span:size*spacing;
    // Font size stays independent of the number of paper lines per text row.
    const fittedSize=size;
    const baseline=ruled?first+Math.max(0,Math.ceil((margin+Math.max(size,leading)-first)/unit))*unit:
      unit?first+Math.max(0,Math.ceil((margin+size-first)/unit))*unit:margin+size;
    return {margin,left,unit,leading,
      size:fittedSize,base:baseline};
  },
  nextMissing(chars,glyphs,target){
    for(let round=0;round<target;round++){
      for(let index=0;index<chars.length;index++){
        if((glyphs[chars[index]]?.length||0)<=round)return{char:chars[index],round:round+1,index};
      }
    }
    return null;
  },
  random(seed,index,salt=0){
    let n=(seed ^ Math.imul(index+1,0x9e3779b1) ^ Math.imul(salt+1,0x85ebca6b))>>>0;
    n=Math.imul(n^(n>>>16),0x7feb352d);n=Math.imul(n^(n>>>15),0x846ca68b);
    return ((n^(n>>>16))>>>0)/4294967296;
  },
  variantIndex(count,seed,index,char){return Math.floor(this.random(seed,index,char.codePointAt(0))*count);},
  gap(char,size,letters,words){return size*(/\s/u.test(char)?words:letters)/100;},
  variation(percent,seed,index){const a=percent/100;return{y:(this.random(seed,index,51)-.5)*a*.5};}
};
if(typeof module!=='undefined')module.exports=Handwriting;

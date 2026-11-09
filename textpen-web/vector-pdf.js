'use strict';
// Small Canvas-compatible vector sink. Layout is shared with the preview.
const VectorPdf = (() => {
  const number = n => {if(!Number.isFinite(n))throw Error('Ungültige PDF-Koordinate');return String(Math.round(n*100000)/100000);};
  const command = (values,op) => values.map(number).join(' ')+' '+op+'\n';
  const color = hex => [1,3,5].map(i=>parseInt(hex.slice(i,i+2),16)/255);
  class Context {
    constructor(width,height){this.vector=true;this.width=width;this.height=height;this.commands='';this.path='';this.stack=[];this.fillStyle=this.strokeStyle='#000000';this.lineWidth=1;this.lineCap=this.lineJoin='round';}
    save(){this.stack.push([this.fillStyle,this.strokeStyle,this.lineWidth,this.lineCap,this.lineJoin,this.font]);this.commands+='q\n';}
    restore(){[this.fillStyle,this.strokeStyle,this.lineWidth,this.lineCap,this.lineJoin,this.font]=this.stack.pop();this.commands+='Q\n';}
    translate(x,y){this.commands+=command([1,0,0,1,x,y],'cm');}
    scale(x,y){this.commands+=command([x,0,0,y,0,0],'cm');}
    beginPath(){this.path='';}
    moveTo(x,y){this.path+=command([x,y],'m');}
    lineTo(x,y){this.path+=command([x,y],'l');}
    arc(x,y,r){
      const k=.5522847498307936*r;this.moveTo(x+r,y);
      for(const points of [[x+r,y+k,x+k,y+r,x,y+r],[x-k,y+r,x-r,y+k,x-r,y],[x-r,y-k,x-k,y-r,x,y-r],[x+k,y-r,x+r,y-k,x+r,y]])this.path+=command(points,'c');
      this.path+='h\n';
    }
    fill(){this.commands+=command(color(this.fillStyle),'rg')+this.path+'f\n';}
    stroke(){this.commands+=command(color(this.strokeStyle),'RG')+command([this.lineWidth],'w')+`${this.lineCap==='round'?1:0} J\n${this.lineJoin==='round'?1:0} j\n`+this.path+'S\n';}
    fillRect(x,y,w,h){this.commands+=command(color(this.fillStyle),'rg')+command([x,y,w,h],'re')+'f\n';}
    textPath(char,x,y,stroke){
      const font=HandwritingVectors,size=parseFloat(this.font),scale=size/font.units;
      const path=font.paths[font.chars[char]??0];
      this.save();this.translate(x,y);this.scale(scale,-scale);
      if(stroke){this.commands+=command(color(this.strokeStyle),'RG')+command([this.lineWidth/scale],'w')+'1 j\n'+path+'S\n';}
      else this.commands+=command(color(this.fillStyle),'rg')+path+'f\n';
      this.restore();
    }
    fillText(char,x,y){this.textPath(char,x,y,false);}
    strokeText(char,x,y){this.textPath(char,x,y,true);}
    drawImage(image,x,y,w,h){this.image=image;this.commands+='q\n'+command([w,0,0,-h,x,y+h],'cm')+'/Paper Do\nQ\n';}
  }
  async function make(pages,widthMm,heightMm){
    const enc=new TextEncoder(),parts=[],offsets=[0];let length=0;
    const add=x=>{const bytes=typeof x==='string'?enc.encode(x):x;parts.push(bytes);length+=bytes.length;};
    const obj=(id,body)=>{offsets[id]=length;add(`${id} 0 obj\n${body}\nendobj\n`);};
    const stream=(id,dict,bytes)=>{offsets[id]=length;add(`${id} 0 obj\n<< ${dict} /Length ${bytes.length} >>\nstream\n`);add(bytes);add('\nendstream\nendobj\n');};
    const w=widthMm*72/25.4,h=heightMm*72/25.4;
    const image=pages.find(page=>page.image)?.image;
    const imageId=3+pages.length*2;
    add('%PDF-1.4\n');obj(1,'<< /Type /Catalog /Pages 2 0 R >>');
    obj(2,`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_,i)=>`${3+i*2} 0 R`).join(' ')}] >>`);
    for(let i=0;i<pages.length;i++){
      const page=pages[i],id=3+i*2;
      obj(id,`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${number(w)} ${number(h)}] /Resources << ${page.image?`/XObject << /Paper ${imageId} 0 R >>`:''} >> /Contents ${id+1} 0 R >>`);
      const content='q\n'+command([w/page.width,0,0,-h/page.height,0,h],'cm')+page.commands+'Q\n';
      let bytes=enc.encode(content),filter='';
      if(typeof CompressionStream!=='undefined'){
        bytes=new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate'))).arrayBuffer());
        filter='/Filter /FlateDecode';
      }
      stream(id+1,filter,bytes);
    }
    // Only a user-supplied photo is rasterized; all writing remains vector paths.
    if(image){
      const canvas=document.createElement('canvas');canvas.width=image.naturalWidth||image.width;canvas.height=image.naturalHeight||image.height;
      const ctx=canvas.getContext('2d');ctx.fillStyle='#ffffff';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(image,0,0);
      const blob=await new Promise((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(Error('Papierbild konnte nicht exportiert werden.')),'image/jpeg',.98));
      stream(imageId,`/Type /XObject /Subtype /Image /Width ${canvas.width} /Height ${canvas.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode`,new Uint8Array(await blob.arrayBuffer()));
    }
    const start=length;add(`xref\n0 ${offsets.length}\n0000000000 65535 f \n`);
    for(let i=1;i<offsets.length;i++)add(String(offsets[i]).padStart(10,'0')+' 00000 n \n');
    add(`trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${start}\n%%EOF\n`);
    return new Blob(parts,{type:'application/pdf'});
  }
  return {Context,make};
})();

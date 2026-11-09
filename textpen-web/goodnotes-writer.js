'use strict';
// Writes a native .goodnotes notebook whose writing is GoodNotes ballpoint ink, so it can be erased,
// lassoed and recoloured there. A PDF cannot do this: GoodNotes flattens imported PDFs into the page background.
// Format: reverse-engineered GoodNotes schema 24, as documented by goodnotes-codec
// (https://github.com/Taylor-Nilsen/goodnotes-codec, docs/FORMAT.md, MIT, (c) 2026 Taylor Nilsen) and checked
// field by field against its real GoodNotes 6 export (tests/fixtures/gn-mac-mixed-pens.goodnotes).
//   const doc=GoodNotesFile.create('Titel'), paper=doc.attach(pdfBytes);
//   const page=doc.addPage(paper,widthPt,heightPt);
//   page.curve([x0,y0, cx,cy,x,y, …],widthPt,[r,g,b,a]);   // pen stroke: start point, then quadratic Béziers
//   page.stroke([x0,y0,x1,y1,…],widthPt,[r,g,b,a]);        // the same through straight pieces
//   const bytes=await doc.save();   // Uint8Array (ZIP)
// All coordinates are PDF points from the top-left corner; GoodNotes page units are 11/6 of a point.
const GoodNotesFile = (() => {
  const VARINT=0,I64=1,LEN=2,I32=5,SCHEMA=24,DJB2_EMPTY=5381,UNIT=11/6,LINE=29.33333396911621;
  const PSTROKE='vuA(v)A(S(uu))A(S(uuuu))vA(f)';
  const enc=new TextEncoder(),bytes=s=>typeof s==='string'?enc.encode(s):s;
  const rand32=()=>crypto.getRandomValues(new Uint32Array(1))[0];
  const rand63=()=>{const a=crypto.getRandomValues(new Uint32Array(2));return BigInt(a[0]&0x7fffffff)<<32n|BigInt(a[1])||1n;};
  const uuid=()=>{const b=crypto.getRandomValues(new Uint8Array(16));b[6]=b[6]&15|64;b[8]=b[8]&63|128;const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('').toUpperCase();return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
  // A page's ink lives in notes/<page id + 1>.
  const uuidPlus=u=>{const h=((BigInt('0x'+u.replace(/-/g,''))+1n)&((1n<<128n)-1n)).toString(16).padStart(32,'0').toUpperCase();return `${h.slice(0,8)}-${h.slice(8,12)}-${h.slice(12,16)}-${h.slice(16,20)}-${h.slice(20)}`;};
  const concat=parts=>{let n=0;for(const p of parts)n+=p.length;const out=new Uint8Array(n);let o=0;for(const p of parts){out.set(p,o);o+=p.length;}return out;};

  // Protobuf: a message is a list of [field, wire type, value]; nested messages are arrays.
  function varint(n,out){
    if(typeof n==='number'){while(n>127){out.push(n%128|128);n=Math.floor(n/128);}out.push(n);return;}
    do{let b=Number(n&127n);n>>=7n;if(n)b|=128;out.push(b);}while(n);
  }
  function encode(msg){
    const out=[];
    for(const [field,type,value] of msg){
      varint(field*8+type,out);
      if(type===VARINT)varint(value,out);
      else if(type===LEN){const b=Array.isArray(value)?encode(value):bytes(value);varint(b.length,out);for(const x of b)out.push(x);}
      else for(const x of value)out.push(x);
    }
    return Uint8Array.from(out);
  }
  const delimited=msgs=>concat(msgs.flatMap(m=>{const b=m instanceof Uint8Array?m:encode(m),n=[];varint(b.length,n);return [Uint8Array.from(n),b];}));
  const S=(f,v)=>[f,LEN,v],I=(f,v)=>[f,VARINT,v];
  const F=(f,v)=>{const b=new Uint8Array(4);new DataView(b.buffer).setFloat32(0,v,true);return [f,I32,b];};
  const D=(f,v)=>{const b=new Uint8Array(8);new DataView(b.buffer).setFloat64(0,v,true);return [f,I64,b];};
  const stamp=(counter=1)=>[...(counter?[I(1,counter)]:[]),I(2,rand32())];
  const lww=value=>[...(value===1?[I(1,1)]:[S(1,value)]),S(2,stamp())];   // last-writer-wins register
  const point=(x,y)=>[...(x?[F(1,x)]:[]),...(y?[F(2,y)]:[])];             // proto3 omits zeros
  const color=rgba=>rgba.flatMap((c,i)=>c?[F(i+1,c)]:[]);

  // Ballpoint geometry: "tpl" template (version, width, command kinds, moves, quads, 1, no width samples),
  // stored as LZ4 literal-only blocks inside "bv41" chunks of at most 32 KiB.
  // path = [x0,y0, cx,cy,x,y, …]: GoodNotes keeps a pen stroke as one start point and quadratic Béziers,
  // so smooth curves arrive there exactly as they are, without being cut into straight pieces.
  function geometry(path,width){
    const quads=Math.max(1,(path.length-2)>>2),schema=enc.encode(PSTROKE+'\0');
    const size=8+schema.length+2+4+4+2*(quads+1)+4+8+4+16*quads+2+4,body=new Uint8Array(size),v=new DataView(body.buffer);
    // 1/32 unit is invisible but makes the numbers compress far better.
    const q=x=>Math.round(x*UNIT*32)/32;
    let o=0;const u16=x=>{v.setUint16(o,x,true);o+=2;},u32=x=>{v.setUint32(o,x,true);o+=4;},f32=x=>{v.setFloat32(o,x,true);o+=4;};
    body.set(enc.encode('tpl\0'));o=4;u32(size);body.set(schema,8);o=8+schema.length;
    u16(2);f32(Math.max(1,Math.round(width*UNIT*64))/64);
    u32(quads+1);u16(0);for(let i=0;i<quads;i++)u16(1);
    u32(1);f32(q(path[0]));f32(q(path[1]));
    u32(quads);
    // A lone dot gets a tiny tail.
    if(path.length<6){f32(q(path[0]+.005));f32(q(path[1]));f32(q(path[0]+.01));f32(q(path[1]));}
    else for(let i=2;i<2+4*quads;i++)f32(q(path[i]));
    u16(1);u32(0);
    const parts=[];
    for(let i=0;i<size;i+=32768){
      const chunk=body.subarray(i,i+32768),len=chunk.length,head=len<15?[len<<4]:[0xf0,...Array(Math.floor((len-15)/255)).fill(255),(len-15)%255];
      const h=new Uint8Array(12),hv=new DataView(h.buffer);h.set(enc.encode('bv41'));hv.setUint32(4,len,true);hv.setUint32(8,head.length+len,true);
      parts.push(h,Uint8Array.from(head),chunk);
    }
    return concat([...parts,enc.encode('bv4$')]);
  }

  const crcTable=Array.from({length:256},(_,n)=>{for(let k=0;k<8;k++)n=n&1?0xedb88320^(n>>>1):n>>>1;return n>>>0;});
  const crc32=b=>{let c=0xffffffff;for(const x of b)c=crcTable[(c^x)&255]^(c>>>8);return (c^0xffffffff)>>>0;};
  async function deflate(b){
    if(typeof CompressionStream==='undefined'||b.length<64)return null;
    const out=new Uint8Array(await new Response(new Blob([b]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
    return out.length<b.length?out:null;
  }
  async function zip(entries){
    const local=[],central=[],d=new Date();let offset=0;
    const time=d.getHours()<<11|d.getMinutes()<<5|d.getSeconds()>>1,date=d.getFullYear()-1980<<9|d.getMonth()+1<<5|d.getDate();
    for(const [name,data] of entries){
      const n=enc.encode(name),packed=await deflate(data),body=packed||data,h=new Uint8Array(30),c=new Uint8Array(46),hv=new DataView(h.buffer),cv=new DataView(c.buffer),crc=crc32(data);
      for(const [v,o] of [[hv,4],[cv,6]]){v.setUint16(o,20,true);v.setUint16(o+2,0x800,true);v.setUint16(o+4,packed?8:0,true);v.setUint16(o+6,time,true);v.setUint16(o+8,date,true);v.setUint32(o+10,crc,true);v.setUint32(o+14,body.length,true);v.setUint32(o+18,data.length,true);v.setUint16(o+22,n.length,true);}
      hv.setUint32(0,0x04034b50,true);cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint32(42,offset,true);
      local.push(h,n,body);central.push(c,n);offset+=30+n.length+body.length;
    }
    const dir=concat(central),e=new Uint8Array(22),ev=new DataView(e.buffer);
    ev.setUint32(0,0x06054b50,true);ev.setUint16(8,entries.length,true);ev.setUint16(10,entries.length,true);ev.setUint32(12,dir.length,true);ev.setUint32(16,offset,true);
    return concat([...local,dir,e]);
  }

  function create(title='TextPen'){
    const did=uuid(),device=rand63(),start=Date.now(),events=[],attachments=[],layers=new Map(),pages=[];
    // Stroke ids: one random UUID prefix per file plus a counter. Still unique, but compresses far better.
    const prefix=uuid().slice(0,24);
    let clock=0,sequence=0,thumbnail=null;
    // Event tail: time, event id, device, strictly increasing hybrid logical clock, schema.
    const tail=()=>{const t=start+clock++;return [D(10,t),S(11,uuid()),I(13,device),I(14,t),I(15,SCHEMA)];};
    const event=(target,kind,body)=>events.push([S(1,target),S(kind,body)]);
    const folder=uuid();
    const t0=start+clock++;
    event(did,30,[S(1,did),S(2,lww(title)),S(3,lww(folder)),S(6,lww('P')),S(7,lww(folder)),S(9,'auto'),D(10,t0),S(11,uuid()),I(13,device),I(14,t0),S(17,''),S(18,''),S(19,[S(2,stamp())]),I(20,SCHEMA)]);
    const notesEvents=(nid,version)=>{
      event(nid,105,[I(1,1),S(2,did),S(4,nid),...(version?[I(5,version)]:[]),S(6,'auto'),...tail()]);
      const t=start+clock++;
      event(nid,104,[S(1,did),S(2,nid),D(10,t),S(11,uuid()),...(version?[I(12,version)]:[]),S(13,'auto'),I(14,1),S(15,uuid()),I(17,device),I(18,t),I(19,SCHEMA)]);
    };
    return {
      /** Stores a PDF (paper) and announces it; GoodNotes ignores attachments without the event. */
      attach(data){
        const aid=uuid(),t=start+clock++;attachments.push([aid,data]);
        const pdf=data[0]===37&&data[1]===80&&data[2]===68&&data[3]===70;
        event(aid,6,[S(1,aid),S(2,aid),I(5,data.length),S(6,did),D(10,t),S(11,uuid()),S(12,pdf?[I(1,1),I(2,1)]:''),I(14,device),I(15,t),I(16,SCHEMA)]);
        if(pdf)event(aid,105,[S(2,did),S(3,aid),...tail()]);
        return aid;
      },
      addPage(paper,widthPt,heightPt){
        const w=widthPt*UNIT,h=heightPt*UNIT,layerKey=paper+'|'+w+'|'+h;
        if(!layers.has(layerKey)){
          const tid=uuid(),t=start+clock++;layers.set(layerKey,tid);
          // Field 18 is the typing area; margins scaled like GoodNotes' standard paper.
          const mx=44*w/834.24,my=58.6667*h/1078.825;
          event(tid,2,[S(1,did),S(2,tid),S(4,paper),I(5,1),I(6,1),D(7,LINE),S(8,point(w,h)),D(10,t),S(11,uuid()),S(12,[D(1,LINE),S(2,stamp())]),S(13,lww(1)),I(15,device),I(16,t),S(17,lww(1)),
            S(18,[S(1,[S(1,point(mx,my)),S(2,point(w-2*mx,h-2*my))]),F(2,28.416668),F(3,.9166667),I(5,1)]),S(19,[S(2,stamp())]),I(21,SCHEMA)]);
        }
        const pid=uuid(),nid=uuidPlus(pid),records=[];
        // Order keys compare as ASCII; fixed width keeps up to 238 328 pages in order.
        const key='K'+[3844,62,1].map(d=>'0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'[Math.floor(pages.length/d)%62]).join('');
        event(pid,54,[S(1,did),S(2,pid),S(3,lww(layers.get(layerKey))),S(4,lww(key)),...tail(),S(17,[S(1,[S(2,[S(1,color([.8667,.8667,.8667,1])),S(2,color([1,1,1,1]))])]),S(2,stamp())])]);
        if(!pages.length)event(did,10,[S(1,did),S(2,pid),S(3,'PagingViewServiceUpdater:'+uuid()),...tail()]);
        notesEvents(nid,0);
        const page={nid,records,
          /** Constant-width ballpoint stroke along a curve [x0,y0, cx,cy,x,y, …] (pt), round caps. [x0,y0] alone is a dot. */
          curve(path,widthPt,rgba=[0,0,0,1]){
            if(path.length<2||path.some(v=>!Number.isFinite(v)))return;
            const sid=prefix+(sequence+1).toString(16).toUpperCase().padStart(12,'0'),st=stamp();
            records.push([S(1,sid),S(2,st),I(8,device),I(9,++sequence),I(14,DJB2_EMPTY),I(16,SCHEMA)],
              [S(7,[S(1,sid),S(2,geometry(path,widthPt)),S(4,color(rgba)),S(6,''),S(7,[S(1,stamp())]),S(9,''),S(15,st),S(20,''),I(21,SCHEMA)])]);
          },
          /** The same through flat [x,y,…] points: every straight piece is a quad whose control point is its middle. */
          stroke(points,widthPt,rgba=[0,0,0,1]){
            const path=points.slice(0,2);
            for(let i=2;i+1<points.length;i+=2)path.push((points[i-2]+points[i])/2,(points[i-1]+points[i+1])/2,points[i],points[i+1]);
            page.curve(path,widthPt,rgba);
          }};
        pages.push(page);return page;
      },
      thumbnail(jpeg){thumbnail=jpeg;},
      async save(){
        if(!pages.length)throw Error('GoodNotes-Datei ohne Seiten');
        // A page that holds ink gets a fresh notes version, then the "items updated" event.
        for(const p of pages)if(p.records.length){notesEvents(p.nid,rand63());event(p.nid,102,[S(1,p.nid),...tail(),S(16,did)]);}
        return zip([
          ['document.info.pb',new Uint8Array()],['index.search.pb',new Uint8Array()],
          ['index.notes.pb',delimited(pages.map(p=>[S(1,p.nid),S(2,'notes/'+p.nid)]))],
          ...pages.map(p=>['notes/'+p.nid,delimited(p.records)]),
          ['index.events.pb',delimited(events)],
          ...(thumbnail?[['thumbnail.jpg',thumbnail]]:[]),
          ['index.attachments.pb',delimited(attachments.map(([id])=>[S(1,id),S(2,'attachments/'+id)]))],
          ...attachments.map(([id,data])=>['attachments/'+id,data]),
          ['schema.pb',Uint8Array.of(8,SCHEMA)]
        ]);
      }
    };
  }
  return {create};
})();
if(typeof module!=='undefined')module.exports=GoodNotesFile;

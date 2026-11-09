const fs=require('fs');const {PNG}=require('C:/Users/jeter/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/pngjs');
const a=PNG.sync.read(fs.readFileSync(process.argv[2])),b=PNG.sync.read(fs.readFileSync(process.argv[3]));let count=0,max=0,x0=a.width,y0=a.height,x1=0,y1=0;
for(let y=0;y<a.height;y++)for(let x=0;x<a.width;x++){const i=(y*a.width+x)*4;let d=0;for(let c=0;c<4;c++)d=Math.max(d,Math.abs(a.data[i+c]-b.data[i+c]));if(d){count++;max=Math.max(max,d);x0=Math.min(x0,x);x1=Math.max(x1,x);y0=Math.min(y0,y);y1=Math.max(y1,y);}}
console.log({count,max,box:[x0,y0,x1,y1],equalPixels:count===0});

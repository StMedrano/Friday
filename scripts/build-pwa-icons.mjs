import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {deflateSync} from 'node:zlib'
import {fileURLToPath} from 'node:url'

const SIGNATURE=Buffer.from([137,80,78,71,13,10,26,10])
const crcTable=Uint32Array.from({length:256},(_,n)=>{
 let c=n
 for(let j=0;j<8;j++)c=c&1?0xedb88320^(c>>>1):c>>>1
 return c>>>0
})
function crc32(data){
 let c=0xffffffff
 for(const byte of data)c=crcTable[(c^byte)&255]^(c>>>8)
 return (c^0xffffffff)>>>0
}
function chunk(type,data){
 const name=Buffer.from(type,'ascii')
 const length=Buffer.alloc(4);length.writeUInt32BE(data.length)
 const checksum=Buffer.alloc(4);checksum.writeUInt32BE(crc32(Buffer.concat([name,data])))
 return Buffer.concat([length,name,data,checksum])
}
const clamp=x=>Math.max(0,Math.min(255,Math.round(x)))
const smooth=(x,a,b)=>Math.max(0,Math.min(1,(x-a)/(b-a)))
const rect=(x,y,x1,y1,x2,y2)=>x>=x1&&x<=x2&&y>=y1&&y<=y2

/**
 * Deterministic opaque RGB launcher icon. The Friday monogram and glow stay
 * inside the central maskable safe area; no third-party raster dependencies.
 */
export function createFridayPng(size){
 if(size!==192&&size!==512)throw Error('unsupported Friday icon size')
 const stride=1+size*3
 const pixels=Buffer.alloc(stride*size)
 for(let row=0;row<size;row++){
  pixels[row*stride]=0
  for(let col=0;col<size;col++){
   const x=(col+.5)/size,y=(row+.5)/size
   const dx=x-.5,dy=y-.5,dist=Math.hypot(dx,dy)
   const glow=Math.max(0,1-dist/.62)
   const ring=dist>.352&&dist<.361 ? .34 : 0
   const vertical=rect(x,y,.335,.298,.413,.704)
   const top=rect(x,y,.335,.298,.668,.38)
   const mid=rect(x,y,.335,.462,.607,.54)
   const mark=vertical||top||mid
   const side=rect(x,y,.405,.385,.426,.455)
   let r=8+glow*4+ring*40
   let g=14+glow*19+ring*90
   let b=23+glow*28+ring*107
   if(mark){r=98;g=222;b=250}
   if(side){r+=5;g+=25;b+=31}
   const n=row*stride+1+col*3
   pixels[n]=clamp(r);pixels[n+1]=clamp(g);pixels[n+2]=clamp(b)
  }
 }
 const ihdr=Buffer.alloc(13)
 ihdr.writeUInt32BE(size,0);ihdr.writeUInt32BE(size,4)
 ihdr[8]=8;ihdr[9]=2 // RGB, no alpha: safe platform launcher background
 return Buffer.concat([
  SIGNATURE,chunk('IHDR',ihdr),chunk('IDAT',deflateSync(pixels,{level:9})),
  chunk('IEND',Buffer.alloc(0)),
 ])
}
export async function writeFridayPwaIcons(outDir='dist'){
 const icons=join(outDir,'icons')
 await mkdir(icons,{recursive:true})
 await Promise.all([192,512].map(size=>
  writeFile(join(icons,`friday-${size}.png`),createFridayPng(size))))
}
if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
 await writeFridayPwaIcons(process.argv[2]||'dist')
}

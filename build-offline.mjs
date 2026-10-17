#!/usr/bin/env node
// Assemble a single portable HTML from the compiled dist, without changing dist.
import {readFile, writeFile, rename} from 'node:fs/promises';
import {dirname, extname, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(fileURLToPath(import.meta.url));
const dist=resolve(root,'dist');
const output=resolve(root,'..','RickMusicWeb.html');
const mime={'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.svg':'image/svg+xml','.woff':'font/woff','.woff2':'font/woff2','.ttf':'font/ttf','.ico':'image/x-icon'};
async function localFile(name) {
 const file=resolve(dist,name.split(/[?#]/)[0]);
 if(!file.startsWith(dist+sep))throw new Error('Ruta de recurso fuera de dist: '+name);
 return {file,bytes:await readFile(file)};
}
async function dataURI(name) {
 if(/^(data:|#)/i.test(name))return name;
 if(/^(https?:|\/\/|blob:)/i.test(name))throw new Error('El recurso externo impide una edición sin conexión: '+name);
 const {file,bytes}=await localFile(name);
 if(!mime[extname(file)])throw new Error('Tipo de recurso no admitido: '+name);
 return `data:${mime[extname(file)]};base64,${bytes.toString('base64')}`;
}
let html=await readFile(resolve(dist,'index.html'),'utf8');
let scripts=0, styles=0;
const embeddedScripts=[];
for(const match of [...html.matchAll(/<link\b[^>]*rel=["']stylesheet["'][^>]*href=["']([^"']+)["'][^>]*>/gi)]) {
 let css=(await localFile(match[1])).bytes.toString('utf8');
 if(/@import\b/i.test(css))throw new Error('CSS con @import debe resolverse antes de crear el HTML autónomo.');
 for(const url of [...css.matchAll(/url\(\s*["']?([^"')\s]+)["']?\s*\)/gi)])css=css.replace(url[0],`url("${await dataURI(url[1])}")`);
 html=html.replace(match[0],()=>'<style>'+css.replace(/<\/style/gi,'<\\/style')+'</style>'); styles++;
}
for(const match of [...html.matchAll(/<(?:img|link)\b[^>]*\b(?:src|href)=["']([^"']+)["'][^>]*>/gi)]) {
 if(match[1].startsWith('data:'))continue;
 html=html.replace(match[0],match[0].replace(match[1],await dataURI(match[1])));
}
for(const match of [...html.matchAll(/<script\b[^>]*src=["']([^"']+)["'][^>]*>\s*<\/script>/gi)]) {
 const js=(await localFile(match[1])).bytes.toString('utf8');
 const block='<script>'+js.replace(/<\/script/gi,'<\\/script')+'</script>';
 embeddedScripts.push(block);
 html=html.replace(match[0],()=>block); scripts++;
}
if(!scripts||!styles)throw new Error('No se encontraron la interfaz JavaScript y su CSS.');
if(/<script\b[^>]*\bsrc=|<link\b[^>]*rel=["']stylesheet/i.test(html))throw new Error('Quedan recursos de interfaz sin incluir.');
const licenses=await readFile(resolve(root,'TERCEROS.txt'),'utf8');
const licenseJSON=JSON.stringify({application:'Rick Music',version:'0.2',licenses}).replace(/</g,'\\u003c');
const bodyEnd=html.toLowerCase().lastIndexOf('</body>');
if(bodyEnd<0)throw new Error('Falta el cierre body de la interfaz.');
html=html.slice(0,bodyEnd)+'<script id="rick-music-licenses" type="application/json">'+licenseJSON+'</script>'+html.slice(bodyEnd);
for(const block of embeddedScripts)if(!html.includes(block))throw new Error('El ensamblado modificó el JavaScript compilado.');
const temp=output+'.new.'+process.pid;
await writeFile(temp,html);
await rename(temp,output);
console.log(`HTML autónomo creado: ${output} (${Buffer.byteLength(html)} bytes, ${scripts} JS y ${styles} CSS incluidos).`);

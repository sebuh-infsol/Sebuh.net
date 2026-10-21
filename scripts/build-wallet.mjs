import {build} from 'esbuild';
import {mkdir,writeFile,rm} from 'node:fs/promises';
await mkdir('site',{recursive:true});
await rm('site/chunks',{recursive:true,force:true});
const result=await build({entryPoints:{'wallet-ui':'src/wallet-ui.mjs','restart-ui':'src/restart-ui.mjs','donations-ui':'src/donations-ui.mjs'},bundle:true,
  outdir:'site',format:'esm',splitting:true,platform:'browser',target:['es2022'],
  inject:['src/buffer-shim.mjs'],
  entryNames:'[name]',chunkNames:'chunks/[name]-[hash]',minify:true,
  legalComments:'linked',metafile:true,logLevel:'info'});
await mkdir('.wrangler',{recursive:true});
await writeFile('.wrangler/wallet-bundle.json',JSON.stringify(result.metafile,null,2));

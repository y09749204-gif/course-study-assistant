const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..','src');
const base=fs.readFileSync(path.join(root,'xueyin-preload.cjs'),'utf8');
const content=fs.readFileSync(path.join(root,'xueyin-content.cjs'),'utf8');
const frame=fs.readFileSync(path.join(root,'xueyin-video-frame.cjs'),'utf8');
const documentFrame=fs.readFileSync(path.join(root,'xueyin-document-frame.cjs'),'utf8');
const documentMarker="require('./xueyin-document-frame.cjs')";
const marker="require('./xueyin-content.cjs')";
const frameMarker="require('./xueyin-video-frame.cjs')";
if(base.split(marker).length!==2||base.split(frameMarker).length!==2||base.split(documentMarker).length!==2)
  throw Error('Expected one Xueyin content and frame insertion point');
const output=base.replace(marker,'runContent()').replace(frameMarker,'runFrame()').replace(documentMarker,'runDocumentFrame()')+
  `\nfunction runContent(){\n${content}\n}\nfunction runFrame(){\n${frame}\n}\nfunction runDocumentFrame(){\n${documentFrame}\n}\n`;
fs.writeFileSync(path.join(root,'xueyin-preload-bundle.cjs'),output,'utf8');

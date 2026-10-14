const test=require('node:test');const assert=require('node:assert/strict');
const {previewLayout,inputPoint}=require('../src/course-preview.cjs');
test('compact course keeps desktop layout and converts input from CSS to native pixels',()=>{
 const {bounds,zoom}=previewLayout([400,582]);
 assert.equal(bounds.height,180);assert.equal(bounds.x,12);assert.equal(bounds.y,386);assert.ok(bounds.width/zoom>=1220);assert.ok(bounds.height/zoom>=600);
 const message={x:600,y:300,width:Math.round(bounds.width/zoom),height:Math.round(bounds.height/zoom)};
 assert.deepEqual(inputPoint(message,bounds,zoom),{x:Math.round(600*zoom),y:Math.round(300*zoom)});
 assert.equal(inputPoint({...message,x:-1},bounds,zoom),null);
 assert.equal(inputPoint({...message,width:100},bounds,zoom),null);
 const expanded=previewLayout([1600,900],360,true);assert.equal(expanded.zoom,1);assert.equal(expanded.bounds.y,52);
});

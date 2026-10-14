function previewLayout(size,sidebar=360,expanded=false){
  const width=Math.max(0,expanded?size[0]-sidebar-4:size[0]-24);
  const height=expanded?Math.max(0,size[1]-52):Math.max(0,Math.min(180,size[1]-398));
  const zoom=expanded?1:Math.max(0.25,Math.min(1,width/1220,height/800));
  return {bounds:{x:expanded?sidebar+4:12,y:expanded?52:386,width,height},zoom};
}
function inputPoint(message,bounds,zoom){
  if(!bounds||!Number.isInteger(message.x)||!Number.isInteger(message.y)||
    !Number.isFinite(message.width)||!Number.isFinite(message.height)||
    Math.abs(message.width*zoom-bounds.width)>2||Math.abs(message.height*zoom-bounds.height)>2||
    message.x<0||message.y<0||message.x>=message.width||message.y>=message.height)return null;
  return {x:Math.min(bounds.width-1,Math.round(message.x*zoom)),y:Math.min(bounds.height-1,Math.round(message.y*zoom))};
}
module.exports={previewLayout,inputPoint};

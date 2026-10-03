export async function wordNeighbors(id, loadPage, startPage = 0) {
 let page=Math.max(0,startPage),data=await loadPage(page),index=data.words.findIndex(w=>w.id===id);
 if(index<0){page=0;data=await loadPage(0);while((index=data.words.findIndex(w=>w.id===id))<0 && (page+1)*25<data.total){data=await loadPage(++page);}}
 if(index<0)return {previous:null,next:null};
 const previous=index>0?data.words[index-1]:page>0?(await loadPage(page-1)).words.at(-1):null;
 const next=index<data.words.length-1?data.words[index+1]:(page+1)*25<data.total?(await loadPage(page+1)).words[0]:null;
 return {previous:previous?.id||null,next:next?.id||null,page};
}
export function swipeDirection(start,end){
 const dx=end.x-start.x,dy=end.y-start.y;
 if(end.time-start.time>1200||Math.abs(dx)<60||Math.abs(dx)<Math.abs(dy)*1.5)return null;
 return dx<0?'next':'previous';
}
export function bindWordSwipe(card,navigate){
 let start=null;
 card.addEventListener('touchstart',event=>{start=null;if(event.touches.length!==1||event.target.closest('a,button,input,textarea,select')||window.getSelection()?.toString())return;const p=event.touches[0];start={x:p.clientX,y:p.clientY,time:Date.now()};},{passive:true});
 card.addEventListener('touchcancel',()=>{start=null;},{passive:true});
 card.addEventListener('touchend',event=>{if(!start||event.touches.length||!card.isConnected){start=null;return;}const p=event.changedTouches[0];if(!p)return;const direction=swipeDirection(start,{x:p.clientX,y:p.clientY,time:Date.now()});start=null;if(direction&&!window.getSelection()?.toString())navigate(direction);},{passive:true});
}

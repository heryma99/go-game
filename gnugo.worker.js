// GNU Go WASM Web Worker
// 主线程通过 postMessage 调用，避免阻塞 UI。
const B=1, W=2;
let ready=false;
let initStarted=false;

self.Module = {
  onRuntimeInitialized: function(){
    ready=true;
    self.postMessage({type:'ready'});
  },
  print: function(){},
  printErr: function(){}
};

// 同源加载 gnugo.js
self.importScripts('./gnugo.js');

function suggest(args){
  if(!ready) return {error:'not ready'};
  const {size, komi, handi, moveLog, color} = args;
  try{
    Module._initializeGoGame(size, komi, handi, 1);
    // 回放人类与电脑的每手棋
    for(const [x,y] of moveLog){
      const rr = Module._moveTo(y, x); // 我们 (x=列,y=行) -> GNU Go (row=y,col=x)
      if(rr!==0) return {error:'replay failed', fallback:true};
    }
    // 推算当前该谁走
    let toMove = handi>0 ? W : B;
    for(let i=0;i<moveLog.length;i++) toMove = (toMove===B?W:B);
    // 若 color 方不是当前 toMove，先生成一手（被吃/停等）把轮次翻过来
    if(toMove !== color){
      Module._genNextStep();
    }
    // 真正为 color 生成应手
    Module._genNextStep();
    let found=null;
    for(let x=0;x<size;x++){
      for(let y=0;y<size;y++){
        if(Module._isLastMove(y, x)){
          found=[x,y]; break;
        }
      }
      if(found) break;
    }
    return found ? {x:found[0], y:found[1]} : {pass:true};
  } catch(e){
    return {error:e && e.message ? e.message : String(e), fallback:true};
  }
}

self.onmessage = function(e){
  const {id, action} = e.data || {};
  if(action==='ping'){
    self.postMessage({id, type:'pong', ready});
    return;
  }
  if(action==='suggest'){
    const result = suggest(e.data);
    self.postMessage({id, type:'suggest', result});
    return;
  }
  self.postMessage({id, type:'error', error:'unknown action: '+action});
};

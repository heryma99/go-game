// GNU Go WASM Web Worker
// 主线程通过 postMessage 调用，避免阻塞 UI。
// 关键设计：只把"对手(opponent)的着法"喂给 GNU Go（电脑自己的着法已由 genNextStep 进入其棋盘）。
// 这样既能与我们对齐，又避免把电脑自己的手用 moveTo 重放而触发超级ko分歧。
const B=1, W=2;
let ready=false;
let processed=0;            // 已处理(喂食/跳过)的着法下标
let curSize=null, curKomi=null, curHandi=null;

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

function reset(size,komi,handi){
  Module._initializeGoGame(size, komi, handi, 1);
  processed=0;
  curSize=size; curKomi=komi; curHandi=handi;
}

// 从当前状态增量推进：只喂对手着法（电脑着法已在盘上，跳过）
function feedIncremental(moveLog, color){
  for(let i=processed; i<moveLog.length; i++){
    const [x,y,c]=moveLog[i];
    if(c===color){ processed=i+1; continue; }   // 电脑自己的手：已在盘上，跳过
    const rr=Module._moveTo(y, x);               // 对手手：GNU Go 当前 to_move 即对手
    if(rr!==0){
      // 罕见分歧（对手这手 GNU Go 视为非法，多为 ko 边界）→ 从头完整重放自愈
      return fullReplay(moveLog, color);
    }
    processed=i+1;
  }
  return true;
}

// 完整重放：对手手用 moveTo，电脑手用 genNextStep（避免用 moveTo 重放电脑手触发超级ko）
function fullReplay(moveLog, color){
  reset(curSize, curKomi, curHandi);
  for(let i=0;i<moveLog.length;i++){
    const [x,y,c]=moveLog[i];
    if(c===color){
      Module._genNextStep();
    } else {
      if(Module._moveTo(y,x)!==0) return false;
    }
    processed=i+1;
  }
  return true;
}

function suggest(args){
  if(!ready) return {error:'not ready'};
  const {size, komi, handi, moveLog, color} = args;
  try{
    // 需在以下情况重置：首启、规则参数变化、或 moveLog 变短（悔棋/新局）
    if(curSize!==size || curKomi!==komi || curHandi!==handi || processed>moveLog.length || processed<0){
      reset(size, komi, handi);
    }
    const ok = feedIncremental(moveLog, color);
    if(!ok) return {error:'replay diverged', fallback:true};
    // 推算 to_move（与喂子顺序一致）
    let toMove = curHandi>0 ? W : B;
    for(let i=0;i<moveLog.length;i++) toMove = (toMove===B?W:B);
    if(toMove !== color){
      // 极罕见轮次不符：从头完整重放校正后再生成
      if(!fullReplay(moveLog,color)) return {error:'replay failed', fallback:true};
    }
    // 为 color 生成应手（只调一次）
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

import {chooseTurn} from './engine.js';
self.onmessage = ({data}) => {
  try { self.postMessage({id:data.id,actions:chooseTurn(data.state,data.level)}); }
  catch { self.postMessage({id:data.id,error:true}); }
};

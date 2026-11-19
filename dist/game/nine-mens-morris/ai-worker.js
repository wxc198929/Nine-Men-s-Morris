import {chooseTurn} from './engine.js';
import {searchBestTurn} from './search.js?v=3';
self.onmessage = ({data}) => {
  try {
    if (data.level === 'hard') self.postMessage({id:data.id,...searchBestTurn(data.state,{avoidActions:data.avoidActions})});
    else self.postMessage({id:data.id,actions:chooseTurn(data.state,data.level)});
  }
  catch { self.postMessage({id:data.id,error:true}); }
};

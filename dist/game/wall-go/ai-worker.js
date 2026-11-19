import {chooseAction} from './search.js';
self.onmessage=({data})=>{try{self.postMessage({id:data.id,...chooseAction(data.state,{level:data.level,avoid:data.avoid})});}catch{self.postMessage({id:data.id,error:true});}};

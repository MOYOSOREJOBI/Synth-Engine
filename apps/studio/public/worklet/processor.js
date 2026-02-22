class PulseSynthProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors(){return [{name:'masterGain',defaultValue:0.45,automationRate:'a-rate'}];}
  process(_i,outputs,params){const l=outputs[0][0];const r=outputs[0][1]||l;const g=params.masterGain;for(let i=0;i<l.length;i++){const gain=g.length>1?g[i]:g[0];l[i]=0;r[i]=0;l[i]*=gain;r[i]*=gain;}return true;}
}
registerProcessor('pulse-synth-processor',PulseSynthProcessor);

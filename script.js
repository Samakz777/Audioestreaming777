/* script.js
   Cliente WebSocket -> AudioWorklet player
   Agora com suporte WSS automático
   Assumimos: Int16 little-endian interleaved PCM, 48kHz, 2 canais
*/

const connectBtn = document.getElementById('connectBtn');
const disconnectBtn = document.getElementById('disconnectBtn');
const wsInput = document.getElementById('wsUrl');
const statusEl = document.getElementById('status');
const modeSel = document.getElementById('mode');
const canvas = document.getElementById('vumeter');
const ctx = canvas.getContext('2d');

let audioCtx = null;
let ws = null;
let workletNode = null;
let processorReady = false;

//=====================================================================
// AudioWorklet
//=====================================================================

async function loadWorklet() {
  if (!audioCtx) return;
  if (audioCtx.audioWorklet) {
    const workletCode = `
    class PCMProcessor extends AudioWorkletProcessor {
      constructor() {
        super();
        this.buffer = [];
        this.readIndex = 0;
        this.channelCount = 2;
        this.port.onmessage = (e) => {
          if (e.data && e.data.samples) {
            this.buffer.push(e.data.samples);
          } else if (e.data === 'clear') {
            this.buffer = [];
          }
        };
      }
      process(inputs, outputs) {
        const output = outputs[0];
        const chCount = output.length;
        const frameSize = output[0].length;

        if (this.buffer.length === 0) {
          for (let ch=0; ch<chCount; ch++) output[ch].fill(0);
          return true;
        }

        let outIndex = 0;

        while (outIndex < frameSize) {
          if (this.buffer.length === 0) {
            for (let ch=0; ch<chCount; ch++) {
              for (let i=outIndex;i<frameSize;i++) output[ch][i] = 0;
            }
            break;
          }
          const chunk = this.buffer[0];
          const chunkFrames = chunk.length / chCount;
          const available = chunkFrames - this.readIndex;
          const toCopy = Math.min(frameSize - outIndex, available);

          for (let f=0; f<toCopy; f++) {
            for (let ch=0; ch<chCount; ch++) {
              output[ch][outIndex + f] = chunk[(this.readIndex + f) * chCount + ch];
            }
          }

          this.readIndex += toCopy;
          outIndex += toCopy;

          if (this.readIndex >= chunkFrames) {
            this.buffer.shift();
            this.readIndex = 0;
          }
        }
        return true;
      }
    }
    registerProcessor('pcm-processor', PCMProcessor);
    `;
    const blob = new Blob([workletCode], {type:'application/javascript'});
    const url = URL.createObjectURL(blob);
    await audioCtx.audioWorklet.addModule(url);
    URL.revokeObjectURL(url);
  }
}

function setStatus(txt, ok=true){
  statusEl.textContent = 'Status: ' + txt;
  statusEl.style.color = ok ? '#9ee7c2' : '#ffb4b4';
}

function drawVUMeter(level){
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0,0,w,h);

  ctx.fillStyle = 'rgba(255,255,255,0.03)';
  ctx.fillRect(0,0,w,h);

  const fillW = Math.max(2, Math.min(w, w * Math.pow(level,0.5)));
  const grad = ctx.createLinearGradient(0,0,fillW,0);
  grad.addColorStop(0,'#6ee7b7');
  grad.addColorStop(1,'#60a5fa');
  ctx.fillStyle = grad;
  ctx.fillRect(0,0, fillW, h);

  ctx.strokeStyle = 'rgba(255,255,255,0.06)';
  ctx.strokeRect(0,0,w,h);
}

async function startAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({
      sampleRate: 48000,
      latencyHint: 'interactive'
    });
    await loadWorklet();
  }

  if (!workletNode) {
    workletNode = new AudioWorkletNode(
      audioCtx,
      'pcm-processor',
      { numberOfOutputs:1, outputChannelCount:[2] }
    );
    workletNode.connect(audioCtx.destination);
    processorReady = true;
  }
}

function floatFromInt16Buffer(bufInt16) {
  const float32 = new Float32Array(bufInt16.length);
  for (let i=0;i<bufInt16.length;i++){
    float32[i] = bufInt16[i] / 32768;
  }
  return float32;
}

function computeRMS(float32) {
  let sum = 0;
  for (let i=0;i<float32.length;i+=2){
    const v = 0.5*(float32[i] + (float32[i+1]||0));
    sum += v*v;
  }
  return Math.sqrt(sum / (float32.length/2));
}

//=====================================================================
//  CONEXÃO (AGORA COM WSS AUTOMÁTICO)
//=====================================================================

connectBtn.addEventListener('click', async () => {
  let url = wsInput.value.trim();
  if (!url) return alert('Informe wss://SEU_IP:8080');

  // Convert ws:// → wss:// automaticamente
  if (url.startsWith("ws://")) {
    url = url.replace("ws://", "wss://");
    wsInput.value = url;
  }

  if (!url.startsWith("wss://")) {
    return alert("A conexão deve ser wss:// (segura)");
  }

  setStatus('Conectando...');

  try {
    await startAudio();
    if (audioCtx.state === 'suspended') {
      await audioCtx.resume();
    }
  } catch (e){
    console.error(e);
    setStatus('Erro ao inicializar áudio', false);
    return;
  }

  ws = new WebSocket(url);
  ws.binaryType = 'arraybuffer';

  ws.onopen = () => {
    setStatus('Conectado (WSS) — aguardando áudio');
    connectBtn.disabled = true;
    disconnectBtn.disabled = false;
  };

  ws.onmessage = (evt) => {
    const arr = new Int16Array(evt.data);
    const float32 = floatFromInt16Buffer(arr);

    if (workletNode && processorReady) {
      workletNode.port.postMessage({ samples: float32 }, [float32.buffer]);
    }

    const rms = computeRMS(float32);
    drawVUMeter(rms);
  };

  ws.onclose = () => {
    setStatus('Conexão fechada', false);
    connectBtn.disabled = false;
    disconnectBtn.disabled = true;
  };

  ws.onerror = (err) => {
    console.error('WS/WSS error', err);
    setStatus('Erro de WebSocket (verifique certificado/HTTPS)', false);
  };
});

disconnectBtn.addEventListener('click', () => {
  if (ws) ws.close();
  if (workletNode) workletNode.port.postMessage('clear');

  setStatus('Desconectado', false);
  connectBtn.disabled = false;
  disconnectBtn.disabled = true;
});

//=====================================================================
// Canvas HiDPI
//=====================================================================

function resizeCanvas(){
  const dpr = window.devicePixelRatio || 1;
  canvas.width = canvas.clientWidth * dpr;
  canvas.height = canvas.clientHeight * dpr;
  ctx.scale(dpr, dpr);
}
window.addEventListener('resize', resizeCanvas);
resizeCanvas();

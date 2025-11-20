document.getElementById("connect-btn").onclick = () => {
    const ip = "ws://192.168.100.6:8080";

    const ws = new WebSocket(ip);
    ws.binaryType = "arraybuffer";

    const status = document.getElementById("status");

    let audioCtx = new AudioContext({ latencyHint: "interactive" });
    let queue = [];

    ws.onopen = () => {
        status.innerText = "Conectado";
        status.style.color = "#00ff7f";
    };

    ws.onmessage = (event) => {
        queue.push(event.data);
        play();
    };

    function play() {
        if (queue.length === 0) return;

        let data = queue.shift();
        let floatData = convertPCM16ToFloat32(new Int16Array(data));

        let buffer = audioCtx.createBuffer(2, floatData.length / 2, 48000);

        buffer.getChannelData(0).set(floatData.filter((v, i) => i % 2 === 0));
        buffer.getChannelData(1).set(floatData.filter((v, i) => i % 2 === 1));

        let src = audioCtx.createBufferSource();
        src.buffer = buffer;
        src.connect(audioCtx.destination);
        src.start();
    }

    function convertPCM16ToFloat32(input) {
        let output = new Float32Array(input.length);
        for (let i = 0; i < input.length; i++) {
            output[i] = input[i] / 32768;
        }
        return output;
    }
};

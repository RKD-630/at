/* ==========================================================================
   AEROTALK JAVASCRIPT APPLICATION CORE ENGINE
   ========================================================================== */

// --- Global App State ---
const state = {
    // Audio Context & Graph
    audioContext: null,
    micStream: null,
    audioSource: null,
    
    // Nodes
    gainNode: null,
    effectsNode: null,
    monitorGainNode: null,
    analyserNode: null,
    
    // Active Effects Graph Nodes
    currentEffect: 'none',
    activeEffectNodes: [],
    
    // States
    isInitialized: false,
    isTransmitting: false,
    isMonitoring: false,
    isLocalLoopback: false, // Testing loopback
    visualizerStyle: 'wave',
    gainValue: 1.0,
    
    // Echo State
    isEchoEnabled: false,
    echoVolume: 0.5,
    echoDelayNode: null,
    echoGainNode: null,
    
    // Media Recording
    mediaRecorder: null,
    recordedChunks: [],
    recordings: [],
    isRecording: false,
    
    // WebRTC Peer-to-Peer
    peerConnection: null,
    dataChannel: null,
    localStream: null,
    remoteStream: null,
    connectionState: 'disconnected', // 'disconnected', 'connecting', 'connected'
    
    // Web Bluetooth GATT
    bleDevice: null,
    bleCharacteristic: null
};

// --- DOM Selectors ---
const DOM = {
    systemStatus: document.getElementById('system-status'),
    micSelect: document.getElementById('mic-select'),
    speakerSelect: document.getElementById('speaker-select'),
    bleScanBtn: document.getElementById('ble-scan-btn'),
    bleStatus: document.getElementById('ble-status'),
    gainSlider: document.getElementById('gain-slider'),
    gainValDisplay: document.getElementById('gain-val'),
    visualizerCanvas: document.getElementById('audio-visualizer'),
    latencyDisplay: document.getElementById('latency-display'),
    monitorToggle: document.getElementById('monitor-toggle'),
    echoToggle: document.getElementById('echo-toggle'),
    echoVolumeSlider: document.getElementById('echo-volume-slider'),
    echoValDisplay: document.getElementById('echo-val'),
    pttBtn: document.getElementById('ptt-btn'),
    
    // Tabs & Panels
    tabHost: document.getElementById('tab-host'),
    tabJoin: document.getElementById('tab-join'),
    hostPanel: document.getElementById('host-panel'),
    joinPanel: document.getElementById('join-panel'),
    
    // WebRTC Actions
    createRoomBtn: document.getElementById('create-room-btn'),
    localSdpContainer: document.getElementById('local-sdp-container'),
    localSdp: document.getElementById('local-sdp'),
    copySdpBtn: document.getElementById('copy-sdp-btn'),
    answerSdpContainer: document.getElementById('answer-sdp-container'),
    answerSdp: document.getElementById('answer-sdp'),
    connectHostBtn: document.getElementById('connect-host-btn'),
    
    hostSdpInput: document.getElementById('host-sdp-input'),
    joinRoomBtn: document.getElementById('join-room-btn'),
    joinResponseContainer: document.getElementById('join-response-container'),
    joinSdpOutput: document.getElementById('join-sdp-output'),
    copyJoinSdpBtn: document.getElementById('copy-join-sdp-btn'),
    connectionStatusBox: document.getElementById('connection-status'),
    connectionStatusText: document.getElementById('connection-status-text'),
    simulatorBtn: document.getElementById('simulator-btn'),
    
    // Effect Cards
    effectCards: document.querySelectorAll('.effect-card'),
    
    // Recording Drawer
    recordBtn: document.getElementById('record-btn'),
    recordingsList: document.getElementById('recordings-list'),
    
    // Modal Specs
    infoTrigger: document.getElementById('info-trigger'),
    techModal: document.getElementById('tech-modal'),
    closeModalBtn: document.getElementById('close-modal-btn')
};

// Canvas 2D Context
const canvasCtx = DOM.visualizerCanvas.getContext('2d');

// --- Initialization & Setup ---
document.addEventListener('DOMContentLoaded', () => {
    setupEventListeners();
    enumerateAudioDevices();
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);
    requestAnimationFrame(renderVisualizer);
});

// Enumerate input devices
async function enumerateAudioDevices() {
    try {
        // Request temporary mic permission to ensure label access
        await navigator.mediaDevices.getUserMedia({ audio: true });
        const devices = await navigator.mediaDevices.enumerateDevices();
        
        DOM.micSelect.innerHTML = '';
        DOM.speakerSelect.innerHTML = '<option value="default">Default Speaker</option>';
        
        let micCount = 0;
        devices.forEach(device => {
            if (device.kind === 'audioinput') {
                const option = document.createElement('option');
                option.value = device.deviceId;
                
                // Identify Bluetooth devices by label metadata
                const label = device.label || `Microphone ${++micCount}`;
                const isBluetooth = label.toLowerCase().includes('bluetooth') || 
                                    label.toLowerCase().includes('hands-free') || 
                                    label.toLowerCase().includes('bt ') ||
                                    label.toLowerCase().includes('headset') ||
                                    label.toLowerCase().includes('buds');
                                    
                option.text = isBluetooth ? `🔵 [Bluetooth] ${label}` : `🎙️ ${label}`;
                DOM.micSelect.appendChild(option);
            } else if (device.kind === 'audiooutput') {
                const option = document.createElement('option');
                option.value = device.deviceId;
                
                const label = device.label || `Speaker`;
                const isBluetooth = label.toLowerCase().includes('bluetooth') || 
                                    label.toLowerCase().includes('hands-free') || 
                                    label.toLowerCase().includes('bt ') ||
                                    label.toLowerCase().includes('headset');
                                    
                option.text = isBluetooth ? `🔵 [Bluetooth] ${label}` : `🔊 ${label}`;
                DOM.speakerSelect.appendChild(option);
            }
        });
        
        if (DOM.micSelect.options.length > 0) {
            DOM.pttBtn.removeAttribute('disabled');
            DOM.recordBtn.removeAttribute('disabled');
        } else {
            DOM.micSelect.innerHTML = '<option value="">No microphones found</option>';
        }
    } catch (err) {
        console.error('Error enumerating audio devices:', err);
        showSystemNotification('Permission Denied / No Mic Found', 'error');
        DOM.micSelect.innerHTML = '<option value="">Permission denied</option>';
    }
}

// Helper to update latency display
function updateLatencyDisplay() {
    if (state.audioContext) {
        // Base Web Audio latency estimation
        const baseLatency = state.audioContext.baseLatency || 0.01;
        const outputLatency = state.audioContext.outputLatency || 0.01;
        const latencyMs = Math.round((baseLatency + outputLatency) * 1000);
        DOM.latencyDisplay.textContent = `LATENCY: ~${latencyMs} ms`;
    }
}

// --- Web Audio Graph Configuration ---
async function initAudioEngine() {
    if (state.isInitialized) return;
    
    // Create AudioContext (standard cross-browser support)
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    state.audioContext = new AudioContextClass({ latencyHint: 'interactive' });
    
    // Create nodes
    state.analyserNode = state.audioContext.createAnalyser();
    state.analyserNode.fftSize = 1024;
    
    state.gainNode = state.audioContext.createGain();
    state.gainNode.gain.value = state.gainValue;
    
    state.monitorGainNode = state.audioContext.createGain();
    // Start muted by default to prevent instant feedback scream
    state.monitorGainNode.gain.value = state.isMonitoring ? state.gainValue : 0;
    
    // Connect monitor output to final audio destination
    state.monitorGainNode.connect(state.audioContext.destination);
    
    state.isInitialized = true;
    updateLatencyDisplay();
}

// Configure mic stream and hook up to DSP graph
async function selectMicrophoneSource(deviceId) {
    await initAudioEngine();
    
    if (state.micStream) {
        state.micStream.getTracks().forEach(track => track.stop());
    }
    
    const constraints = {
        audio: {
            deviceId: deviceId ? { exact: deviceId } : undefined,
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: false
        }
    };
    
    try {
        state.micStream = await navigator.mediaDevices.getUserMedia(constraints);
        
        // Resume AudioContext if suspended (browser security check)
        if (state.audioContext.state === 'suspended') {
            await state.audioContext.resume();
        }
        
        state.audioSource = state.audioContext.createMediaStreamSource(state.micStream);
        rebuildAudioGraph();
        
    } catch (err) {
        console.error('Error selecting microphone:', err);
        showSystemNotification('Could not start microphone stream', 'error');
    }
}

// Connect audio nodes dynamically based on PTT, simulator, and monitoring
function rebuildAudioGraph() {
    if (!state.isInitialized || !state.audioSource) return;
    
    // Disconnect everything first
    state.audioSource.disconnect();
    if (state.effectsNode) {
        state.effectsNode.disconnect();
    }
    state.gainNode.disconnect();
    if (state.echoDelayNode) {
        try { state.echoDelayNode.disconnect(); } catch(e){}
        try { state.echoGainNode.disconnect(); } catch(e){}
    }
    
    // Apply Selected Audio Effect Chain
    const effectsChain = buildEffectsChain();
    
    let currentOut = state.audioSource;
    
    // Route: Mic Source -> Effect Processor -> (Echo Processor) -> Gain Volume Controller -> Analyser
    if (effectsChain.input && effectsChain.output) {
        currentOut.connect(effectsChain.input);
        currentOut = effectsChain.output;
    }
    
    if (state.isEchoEnabled) {
        if (!state.echoDelayNode) {
            state.echoDelayNode = state.audioContext.createDelay(5.0);
            state.echoGainNode = state.audioContext.createGain();
        }
        
        state.echoDelayNode.delayTime.value = 0.4; // 400ms delay
        state.echoGainNode.gain.value = state.echoVolume;
        
        // Connect Dry signal to main output gain
        currentOut.connect(state.gainNode);
        
        // Send signal into the delay node
        currentOut.connect(state.echoDelayNode);
        
        // The delay node goes into the echo gain node
        state.echoDelayNode.connect(state.echoGainNode);
        
        // Feedback loop: echo gain node feeds back into delay node for repeating echo
        state.echoGainNode.connect(state.echoDelayNode);
        
        // Mix echo output into the main output gain
        state.echoGainNode.connect(state.gainNode);
    } else {
        // Direct clean routing
        currentOut.connect(state.gainNode);
    }
    
    state.gainNode.connect(state.analyserNode);
    
    // Monitor output volume routing
    // When loopback is on OR monitor switch is checked, route visualizer output to speaker
    try { state.analyserNode.disconnect(state.monitorGainNode); } catch(e) {}
    if (state.isLocalLoopback || state.isMonitoring) {
        state.analyserNode.connect(state.monitorGainNode);
    }
    
    // Connect WebRTC local media sender track to the gainNode
    if (state.localStream) {
        // WebRTC will send the processed signal!
        // We create an AudioDestinationNode to capture the processed stream.
        const dest = state.audioContext.createMediaStreamDestination();
        state.gainNode.connect(dest);
        
        // Swap sender track
        const track = dest.stream.getAudioTracks()[0];
        if (state.peerConnection) {
            const senders = state.peerConnection.getSenders();
            const sender = senders.find(s => s.track && s.track.kind === 'audio');
            if (sender) {
                sender.replaceTrack(track);
            }
        }
    }
}

// --- Voice Effects Digital Signal Processors (DSP) ---
function buildEffectsChain() {
    // Clean up old active effects
    state.activeEffectNodes.forEach(node => {
        try { node.disconnect(); } catch(e){}
    });
    state.activeEffectNodes = [];
    
    const ctx = state.audioContext;
    let inputNode = null;
    let outputNode = null;
    
    if (state.currentEffect === 'none') {
        return { input: null, output: null };
    }
    
    if (state.currentEffect === 'walkie') {
        // WALKIE TALKIE VHF FILTER EFFECT
        // Telephone band: high-pass at 400Hz, low-pass at 2500Hz
        const highpass = ctx.createBiquadFilter();
        highpass.type = 'highpass';
        highpass.frequency.value = 500;
        highpass.Q.value = 1.0;
        
        const lowpass = ctx.createBiquadFilter();
        lowpass.type = 'lowpass';
        lowpass.frequency.value = 2400;
        lowpass.Q.value = 1.2;
        
        // Saturation/Distortion to simulate analog clipping
        const dist = ctx.createWaveShaper();
        dist.curve = makeDistortionCurve(60);
        dist.oversample = '4x';
        
        // Chain nodes: highpass -> lowpass -> distortion
        highpass.connect(lowpass);
        lowpass.connect(dist);
        
        state.activeEffectNodes = [highpass, lowpass, dist];
        inputNode = highpass;
        outputNode = dist;
    } 
    else if (state.currentEffect === 'robot') {
        // ROBOT SYNTH EFFECT (Ring Modulation)
        // Split voice signal, multiply it by a high-frequency sine oscillator
        const modulator = ctx.createOscillator();
        modulator.type = 'sine';
        modulator.frequency.value = 65; // Modulator frequency in Hz (creates robot raspiness)
        
        const modulationGain = ctx.createGain();
        modulationGain.gain.value = 1.0;
        
        // Multiplier gain node
        const multiplier = ctx.createGain();
        multiplier.gain.value = 0.0; // Multiplied carrier
        
        // Modulator controls the gain level of the multiplier node dynamically
        modulator.connect(modulationGain);
        modulationGain.connect(multiplier.gain);
        modulator.start(0);
        
        // Simple bandpass to make the synthetic voice clearer
        const bandpass = ctx.createBiquadFilter();
        bandpass.type = 'bandpass';
        bandpass.frequency.value = 1200;
        bandpass.Q.value = 0.8;
        
        bandpass.connect(multiplier);
        
        state.activeEffectNodes = [modulator, modulationGain, multiplier, bandpass];
        inputNode = bandpass;
        outputNode = multiplier;
    } 
    else if (state.currentEffect === 'cave') {
        // DEEP CAVE REVERB EFFECT
        // Generates a synthetic impulse response of a large hall
        const convolver = ctx.createConvolver();
        convolver.buffer = createReverbImpulseResponse(2.8, 2.0); // 2.8s decay duration
        
        // Dry/Wet Blend nodes
        const dryGain = ctx.createGain();
        const wetGain = ctx.createGain();
        
        dryGain.gain.value = 0.6;
        wetGain.gain.value = 0.5;
        
        const merger = ctx.createGain();
        
        // Input splits to dry and convolver, joins in merger
        dryGain.connect(merger);
        convolver.connect(wetGain);
        wetGain.connect(merger);
        
        // Setup simple splitting hook node
        const inputSplitter = ctx.createGain();
        inputSplitter.connect(dryGain);
        inputSplitter.connect(convolver);
        
        state.activeEffectNodes = [inputSplitter, convolver, dryGain, wetGain, merger];
        inputNode = inputSplitter;
        outputNode = merger;
    }
    
    state.effectsNode = outputNode;
    return { input: inputNode, output: outputNode };
}

// WaveShaper distortion curves generator
function makeDistortionCurve(amount) {
    const k = typeof amount === 'number' ? amount : 50;
    const n_samples = 44100;
    const curve = new Float32Array(n_samples);
    const deg = Math.PI / 180;
    for (let i = 0; i < n_samples; ++i) {
        const x = (i * 2) / n_samples - 1;
        curve[i] = ((3 + k) * x * 20 * deg) / (Math.PI + k * Math.abs(x));
    }
    return curve;
}

// Programmatic Impulse Response Builder (Reverb Room Generator)
function createReverbImpulseResponse(duration, decay) {
    const ctx = state.audioContext;
    const sampleRate = ctx.sampleRate;
    const length = Math.floor(sampleRate * duration);
    const impulse = ctx.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);
    
    for (let i = 0; i < length; i++) {
        const percent = i / length;
        // Exponential decay of random white noise
        const val = (Math.random() * 2 - 1) * Math.pow(1 - percent, decay);
        left[i] = val;
        right[i] = val;
    }
    return impulse;
}

// --- Synthesized Sound Effects (PTT Squelch & Roger Beep) ---
function playRadioBeep(type) {
    if (!state.isInitialized) return;
    
    const ctx = state.audioContext;
    const osc = ctx.createOscillator();
    const beepGain = ctx.createGain();
    
    beepGain.connect(ctx.destination);
    osc.connect(beepGain);
    
    const now = ctx.currentTime;
    
    if (type === 'start') {
        // High frequency micro key squelch beep + static chirp
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(150, now + 0.08);
        
        beepGain.gain.setValueAtTime(0.08, now);
        beepGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        
        osc.start(now);
        osc.stop(now + 0.09);
        
        // Overlay a short white noise burst for radio static realism
        playStaticBurst(0.08, 0.05);
    } 
    else if (type === 'stop') {
        // Classic Walkie-Talkie Roger Beep (dual-tone)
        osc.type = 'sine';
        osc.frequency.setValueAtTime(880, now); // Pitch 1
        beepGain.gain.setValueAtTime(0.12, now);
        
        // Shift frequency down for second beep part
        osc.frequency.setValueAtTime(880, now + 0.1);
        osc.frequency.setValueAtTime(740, now + 0.1); // Pitch 2
        
        beepGain.gain.setValueAtTime(0.12, now + 0.1);
        beepGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
        
        osc.start(now);
        osc.stop(now + 0.25);
        
        // Crackling squelch tail static burst at release
        playStaticBurst(0.24, 0.08);
    }
}

// Synthetic Radio Static Generator
function playStaticBurst(duration, volume) {
    const ctx = state.audioContext;
    const bufferSize = Math.floor(ctx.sampleRate * duration);
    const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    
    // Fill buffer with random noise values
    for (let i = 0; i < bufferSize; i++) {
        data[i] = Math.random() * 2 - 1;
    }
    
    const noiseNode = ctx.createBufferSource();
    noiseNode.buffer = buffer;
    
    // Filter noise to sound like radio frequencies (bandpass around 1000Hz)
    const bandpass = ctx.createBiquadFilter();
    bandpass.type = 'bandpass';
    bandpass.frequency.value = 1100;
    bandpass.Q.value = 1.0;
    
    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(volume, ctx.currentTime);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + duration);
    
    noiseNode.connect(bandpass);
    bandpass.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    
    noiseNode.start();
}

// --- Push-To-Talk Transmission Controls ---
async function startTransmission() {
    if (state.isTransmitting) return;
    
    try {
        if (!state.isInitialized || !state.micStream) {
            const micId = DOM.micSelect.value;
            await selectMicrophoneSource(micId);
        }
        
        if (state.audioContext && state.audioContext.state === 'suspended') {
            await state.audioContext.resume().catch(()=>{});
        }
        
        state.isTransmitting = true;
        
        // Squelch Audio beep
        playRadioBeep('start');
        
        // Wait a slight delay for squelch beep, then unmute
        setTimeout(() => {
            if (state.isTransmitting) {
                // Set monitor state to active if local feedback is toggled
                if (state.isMonitoring || state.isLocalLoopback) {
                    state.monitorGainNode.gain.setValueAtTime(state.gainValue, state.audioContext.currentTime);
                }
                
                // UI updates
                DOM.pttBtn.classList.add('transmitting');
                DOM.pttBtn.querySelector('.ptt-text').textContent = 'TRANSMITTING';
                DOM.pttBtn.querySelector('.ptt-subtext').textContent = 'Live link active';
                updateSystemStatus('TRANSMITTING', 'transmitting');
                
                // Start Media Recording if active
                if (state.isRecording && state.mediaRecorder && state.mediaRecorder.state === 'inactive') {
                    state.recordedChunks = [];
                    state.mediaRecorder.start();
                }
            }
        }, 80);
        
    } catch (e) {
        console.error('PTT activation failure:', e);
        state.isTransmitting = false;
    }
}

function stopTransmission() {
    if (!state.isTransmitting) return;
    
    state.isTransmitting = false;
    
    // Mute microphone output instantly
    if (state.monitorGainNode) {
        state.monitorGainNode.gain.setValueAtTime(0, state.audioContext.currentTime);
    }
    
    // Play release Roger Beep
    playRadioBeep('stop');
    
    // Stop recording
    if (state.isRecording && state.mediaRecorder && state.mediaRecorder.state === 'recording') {
        state.mediaRecorder.stop();
    }
    
    // Reset UI states
    DOM.pttBtn.classList.remove('transmitting');
    DOM.pttBtn.querySelector('.ptt-text').textContent = 'PTT STANDBY';
    DOM.pttBtn.querySelector('.ptt-subtext').textContent = 'Click & hold or SPACE';
    
    if (state.connectionState === 'connected') {
        updateSystemStatus('P2P LINK ONLINE', 'receiving');
    } else {
        updateSystemStatus('SYSTEM IDLE', 'idle');
    }
}

// --- Canvas Audio Visualizers Render Pipeline ---
function resizeCanvas() {
    const rect = DOM.visualizerCanvas.parentElement.getBoundingClientRect();
    DOM.visualizerCanvas.width = rect.width;
    DOM.visualizerCanvas.height = rect.height;
}

function renderVisualizer() {
    requestAnimationFrame(renderVisualizer);
    
    const width = DOM.visualizerCanvas.width;
    const height = DOM.visualizerCanvas.height;
    
    // Clear canvas with dark gradient bleed background
    canvasCtx.fillStyle = 'rgba(6, 9, 17, 0.25)';
    canvasCtx.fillRect(0, 0, width, height);
    
    if (!state.isInitialized || !state.analyserNode) {
        // Draw elegant loading orbit circle when dormant
        drawDormantState(width, height);
        return;
    }
    
    const bufferLength = state.analyserNode.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    
    // Pick visualizer style render logic
    if (state.visualizerStyle === 'wave') {
        state.analyserNode.getByteTimeDomainData(dataArray);
        drawWaveVisualizer(dataArray, bufferLength, width, height);
    } 
    else if (state.visualizerStyle === 'bars') {
        state.analyserNode.getByteFrequencyData(dataArray);
        drawBarsVisualizer(dataArray, bufferLength, width, height);
    } 
    else if (state.visualizerStyle === 'radar') {
        state.analyserNode.getByteFrequencyData(dataArray);
        drawRadarVisualizer(dataArray, bufferLength, width, height);
    }
}

// Elegant radial pulsing when microphone is idle/not initialized
let radarRot = 0;
function drawDormantState(width, height) {
    const cx = width / 2;
    const cy = height / 2;
    
    canvasCtx.strokeStyle = 'rgba(0, 240, 255, 0.08)';
    canvasCtx.lineWidth = 1;
    
    // Oscillating static rings
    for (let r = 50; r <= 150; r += 40) {
        const pulseR = r + Math.sin(Date.now() * 0.002 + r) * 4;
        canvasCtx.beginPath();
        canvasCtx.arc(cx, cy, pulseR, 0, Math.PI * 2);
        canvasCtx.stroke();
    }
    
    // Sweeping Radar Line
    radarRot += 0.01;
    canvasCtx.strokeStyle = 'rgba(0, 240, 255, 0.25)';
    canvasCtx.lineWidth = 2;
    canvasCtx.beginPath();
    canvasCtx.moveTo(cx, cy);
    canvasCtx.lineTo(cx + Math.cos(radarRot) * 150, cy + Math.sin(radarRot) * 150);
    canvasCtx.stroke();
    
    // Central glowing core
    canvasCtx.fillStyle = 'rgba(0, 240, 255, 0.4)';
    canvasCtx.beginPath();
    canvasCtx.arc(cx, cy, 4, 0, Math.PI * 2);
    canvasCtx.fill();
}

// Style 1: Oscilloscope Line (Time domain)
function drawWaveVisualizer(dataArray, bufferLength, width, height) {
    canvasCtx.lineWidth = 3;
    
    // Create gradient based on transmission status
    let strokeGrad = canvasCtx.createLinearGradient(0, 0, width, 0);
    if (state.isTransmitting) {
        strokeGrad.addColorStop(0, '#ff4d4d');
        strokeGrad.addColorStop(0.5, '#ff8080');
        strokeGrad.addColorStop(1, '#ff3333');
    } else {
        strokeGrad.addColorStop(0, '#00f0ff');
        strokeGrad.addColorStop(0.5, '#7000ff');
        strokeGrad.addColorStop(1, '#00f0ff');
    }
    canvasCtx.strokeStyle = strokeGrad;
    canvasCtx.shadowBlur = 15;
    canvasCtx.shadowColor = state.isTransmitting ? 'rgba(255, 20, 80, 0.6)' : 'rgba(0, 240, 255, 0.5)';
    
    canvasCtx.beginPath();
    const sliceWidth = width / bufferLength;
    let x = 0;
    
    for (let i = 0; i < bufferLength; i++) {
        const v = dataArray[i] / 128.0;
        // Dampen the wave amplitude if we aren't transmitting
        const amp = state.isTransmitting || state.isMonitoring || state.isLocalLoopback ? 1.0 : 0.03;
        const y = (v * height) / 2 + (amp - 1.0) * (height / 2);
        
        if (i === 0) {
            canvasCtx.moveTo(x, y);
        } else {
            canvasCtx.lineTo(x, y);
        }
        x += sliceWidth;
    }
    
    canvasCtx.lineTo(width, height / 2);
    canvasCtx.stroke();
    canvasCtx.shadowBlur = 0; // Reset shadow for efficiency
}

// Style 2: Symmetric Audio Frequency bars
function drawBarsVisualizer(dataArray, bufferLength, width, height) {
    const barWidth = (width / (bufferLength / 2.5));
    let barHeight;
    let x = 0;
    
    // Glowing gradient fill
    let barGrad = canvasCtx.createLinearGradient(0, height, 0, 0);
    if (state.isTransmitting) {
        barGrad.addColorStop(0, 'rgba(255, 20, 50, 0.2)');
        barGrad.addColorStop(1, 'rgba(255, 80, 80, 0.95)');
    } else {
        barGrad.addColorStop(0, 'rgba(112, 0, 255, 0.2)');
        barGrad.addColorStop(1, 'rgba(0, 240, 255, 0.95)');
    }
    
    canvasCtx.fillStyle = barGrad;
    canvasCtx.shadowBlur = 6;
    canvasCtx.shadowColor = state.isTransmitting ? 'rgba(255, 20, 80, 0.4)' : 'rgba(0, 240, 255, 0.3)';
    
    for (let i = 0; i < bufferLength; i++) {
        // Enforce audio output gain modulation visually
        const amp = state.isTransmitting || state.isMonitoring || state.isLocalLoopback ? 1.4 : 0.05;
        barHeight = (dataArray[i] * amp);
        
        // Draw dual symmetric mirror-bars
        canvasCtx.fillRect(x, height - barHeight, barWidth - 2, barHeight);
        canvasCtx.fillRect(width - x - barWidth, height - barHeight, barWidth - 2, barHeight);
        
        x += barWidth + 1;
        if (x > width / 2) break;
    }
    canvasCtx.shadowBlur = 0;
}

// Style 3: Sonar / Radar Frequency Web Equalizer
function drawRadarVisualizer(dataArray, bufferLength, width, height) {
    const cx = width / 2;
    const cy = height / 2;
    const baseRadius = 60;
    
    // Set theme shadows
    canvasCtx.shadowBlur = 12;
    canvasCtx.shadowColor = state.isTransmitting ? 'rgba(255, 20, 80, 0.5)' : 'rgba(0, 240, 255, 0.4)';
    canvasCtx.strokeStyle = state.isTransmitting ? 'rgba(255, 80, 80, 0.8)' : 'rgba(0, 240, 255, 0.8)';
    canvasCtx.lineWidth = 2.5;
    
    // Draw circular audio equalizer path
    canvasCtx.beginPath();
    
    const numPoints = 120;
    const angleStep = (Math.PI * 2) / numPoints;
    
    for (let i = 0; i < numPoints; i++) {
        // Enforce audio active levels
        const ampFactor = state.isTransmitting || state.isMonitoring || state.isLocalLoopback ? 0.6 : 0.02;
        const value = dataArray[i % (bufferLength / 4)] || 0;
        const radius = baseRadius + (value * ampFactor);
        
        const angle = i * angleStep + radarRot;
        const x = cx + Math.cos(angle) * radius;
        const y = cy + Math.sin(angle) * radius;
        
        if (i === 0) {
            canvasCtx.moveTo(x, y);
        } else {
            canvasCtx.lineTo(x, y);
        }
    }
    
    canvasCtx.closePath();
    canvasCtx.stroke();
    
    // Inner radar sweeps
    canvasCtx.shadowBlur = 0;
    canvasCtx.strokeStyle = 'rgba(0, 240, 255, 0.05)';
    canvasCtx.lineWidth = 1;
    canvasCtx.beginPath();
    canvasCtx.arc(cx, cy, baseRadius, 0, Math.PI * 2);
    canvasCtx.stroke();
    
    // Sweep Line
    radarRot += 0.012;
}

// --- WebRTC Peer-to-Peer Configuration (Serverless SDP Exchange) ---
const rtcConfig = {
    iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
    ]
};

// Create peer connection
async function createPeerConnection() {
    await initAudioEngine();
    
    state.peerConnection = new RTCPeerConnection(rtcConfig);
    
    // Setup communication data channel (for sync verification)
    state.dataChannel = state.peerConnection.createDataChannel('aero-signaling');
    setupDataChannelListeners();
    
    // Setup capture stream destination
    const destNode = state.audioContext.createMediaStreamDestination();
    state.gainNode.connect(destNode);
    state.localStream = destNode.stream;
    
    // Add local tracks to RTC
    state.localStream.getTracks().forEach(track => {
        state.peerConnection.addTrack(track, state.localStream);
    });
    
    // Connection track remote voice
    state.peerConnection.ontrack = (event) => {
        state.remoteStream = event.streams[0];
        playRemoteAudioStream(state.remoteStream);
    };
    
    // Manage Connection Changes
    state.peerConnection.onconnectionstatechange = () => {
        handleRtcStateChange(state.peerConnection.connectionState);
    };
}

// Setup Data Channel listeners
function setupDataChannelListeners() {
    if (!state.dataChannel) return;
    
    state.dataChannel.onopen = () => {
        console.log('WebRTC signaling data channel open.');
    };
    
    state.dataChannel.onmessage = (event) => {
        // Custom message parser (e.g. handle peer transmit trigger signals)
        const msg = JSON.parse(event.data);
        if (msg.type === 'ptt_active') {
            setPeerTransmitting(true);
        } else if (msg.type === 'ptt_inactive') {
            setPeerTransmitting(false);
        }
    };
}

// Play remote peer speech stream through local browser Audio Graph
function playRemoteAudioStream(stream) {
    if (!state.audioContext) return;
    
    // Route incoming peer audio to context for visualizations
    const remoteSource = state.audioContext.createMediaStreamSource(stream);
    
    // Create remote volume gain node
    const remoteVolume = state.audioContext.createGain();
    remoteVolume.gain.value = 1.0;
    
    // Connect remote source to analyzer so visualization displays incoming waves!
    remoteSource.connect(remoteVolume);
    remoteVolume.connect(state.analyserNode);
    remoteVolume.connect(state.audioContext.destination);
    
    showSystemNotification('Remote audio feed connected', 'success');
}

// Base64 encoding tools for session description protocols
function encodeSdp(sdpObject) {
    return btoa(JSON.stringify(sdpObject));
}

function decodeSdp(sdpString) {
    try {
        return JSON.parse(atob(sdpString.trim()));
    } catch (e) {
        showSystemNotification('Invalid Connection Code Format', 'error');
        return null;
    }
}

// Host Room Start Button Trigger
async function handleHostRoomCreation() {
    updateSystemStatus('CREATING ROOM...', 'idle');
    await createPeerConnection();
    
    // Create Local SDP Offer
    const offer = await state.peerConnection.createOffer();
    await state.peerConnection.setLocalDescription(offer);
    
    const showLocalKey = () => {
        if (state.peerConnection && state.peerConnection.localDescription) {
            const encoded = encodeSdp(state.peerConnection.localDescription);
            DOM.localSdp.value = encoded;
            DOM.localSdpContainer.classList.remove('hidden');
            DOM.answerSdpContainer.classList.remove('hidden');
            updateSystemStatus('WAITING FOR PEER', 'idle');
        }
    };

    // Trigger on candidate gathering end or complete
    state.peerConnection.onicecandidate = (event) => {
        if (!event.candidate || state.peerConnection.iceGatheringState === 'complete') {
            showLocalKey();
        }
    };

    // Instant fallback timeout for fast user experience
    setTimeout(showLocalKey, 1200);
}

// Host Room Final Connect Button Trigger
async function handleHostRoomConnection() {
    const answerCode = DOM.answerSdp.value;
    if (!answerCode) {
        showSystemNotification('Please paste response code', 'error');
        return;
    }
    
    const remoteSdp = decodeSdp(answerCode);
    if (!remoteSdp) return;
    
    try {
        await state.peerConnection.setRemoteDescription(new RTCSessionDescription(remoteSdp));
        updateSystemStatus('LINK ESTABLISHED', 'receiving');
    } catch (err) {
        console.error('Remote Description setup failed:', err);
        showSystemNotification('Connection setup failed', 'error');
    }
}

// Join Room Start Button Trigger (Generate Response)
async function handleJoinRoom() {
    const hostCode = DOM.hostSdpInput.value;
    if (!hostCode) {
        showSystemNotification('Please paste connection code', 'error');
        return;
    }
    
    const remoteSdp = decodeSdp(hostCode);
    if (!remoteSdp) return;
    
    updateSystemStatus('CONNECTING...', 'idle');
    await createPeerConnection();
    
    // Set remote host description
    await state.peerConnection.setRemoteDescription(new RTCSessionDescription(remoteSdp));
    
    // Create Answer
    const answer = await state.peerConnection.createAnswer();
    await state.peerConnection.setLocalDescription(answer);
    
    // Await ICE candidates
    const showJoinResponse = () => {
        if (state.peerConnection && state.peerConnection.localDescription) {
            const encoded = encodeSdp(state.peerConnection.localDescription);
            DOM.joinSdpOutput.value = encoded;
            DOM.joinResponseContainer.classList.remove('hidden');
            updateSystemStatus('GENERATED RESPONSE', 'idle');
        }
    };

    state.peerConnection.onicecandidate = (event) => {
        if (!event.candidate || state.peerConnection.iceGatheringState === 'complete') {
            showJoinResponse();
        }
    };

    setTimeout(showJoinResponse, 1200);
    
    // Bind data channel
    state.peerConnection.ondatachannel = (event) => {
        state.dataChannel = event.channel;
        setupDataChannelListeners();
    };
}

// Handler for connection status
function handleRtcStateChange(connectionState) {
    console.log(`Connection state: ${connectionState}`);
    
    DOM.connectionStatusBox.className = 'connection-status-box';
    
    if (connectionState === 'connected') {
        state.connectionState = 'connected';
        DOM.connectionStatusBox.classList.add('online');
        DOM.connectionStatusText.textContent = 'P2P Link Online (Encrypted)';
        updateSystemStatus('P2P LINK ONLINE', 'receiving');
        showSystemNotification('Peer connected successfully!', 'success');
    } 
    else if (connectionState === 'connecting') {
        state.connectionState = 'connecting';
        DOM.connectionStatusText.textContent = 'P2P Link Connecting...';
    } 
    else {
        state.connectionState = 'disconnected';
        DOM.connectionStatusText.textContent = 'P2P Channel Offline';
        updateSystemStatus('SYSTEM IDLE', 'idle');
    }
}

// Manage visual transmission signals from remote peer
function setPeerTransmitting(active) {
    if (active) {
        DOM.pttBtn.classList.add('receiving');
        DOM.pttBtn.querySelector('.ptt-text').textContent = 'RECEIVING';
        DOM.pttBtn.querySelector('.ptt-subtext').textContent = 'Remote transmission active';
        updateSystemStatus('RECEIVING VOICE', 'receiving');
    } else {
        DOM.pttBtn.classList.remove('receiving');
        DOM.pttBtn.querySelector('.ptt-text').textContent = 'PTT STANDBY';
        DOM.pttBtn.querySelector('.ptt-subtext').textContent = 'Click & hold or SPACE';
        updateSystemStatus('P2P LINK ONLINE', 'receiving');
    }
}

// Notify peers of our PTT button actions
function sendPttSignal(active) {
    if (state.dataChannel && state.dataChannel.readyState === 'open') {
        state.dataChannel.send(JSON.stringify({
            type: active ? 'ptt_active' : 'ptt_inactive'
        }));
    }
}

// --- Voice Recording Drawer Engine ---
function toggleRecordingEngine() {
    if (state.isRecording) {
        // Stop recording workflow
        state.isRecording = false;
        DOM.recordBtn.classList.remove('btn-secondary');
        DOM.recordBtn.classList.add('btn-danger');
        DOM.recordBtn.querySelector('span').textContent = 'Record Voice';
        showSystemNotification('Recording Mode Disabled', 'info');
    } else {
        // Start recording workflow
        setupMediaRecorder();
        state.isRecording = true;
        DOM.recordBtn.classList.remove('btn-danger');
        DOM.recordBtn.classList.add('btn-secondary');
        DOM.recordBtn.querySelector('span').textContent = 'ARMED: Press PTT';
        showSystemNotification('Armed! Speak via PTT button to save clip.', 'success');
    }
}

function setupMediaRecorder() {
    if (!state.micStream) return;
    
    // Set recording stream source from browser capture node (saves post-FX audio!)
    const dest = state.audioContext.createMediaStreamDestination();
    state.gainNode.connect(dest);
    
    state.mediaRecorder = new MediaRecorder(dest.stream);
    
    state.mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
            state.recordedChunks.push(e.data);
        }
    };
    
    state.mediaRecorder.onstop = () => {
        const audioBlob = new Blob(state.recordedChunks, { type: 'audio/webm' });
        saveRecording(audioBlob);
    };
}

function saveRecording(blob) {
    const url = URL.createObjectURL(blob);
    const id = Date.now();
    const name = `Transmission #${state.recordings.length + 1}`;
    
    const recordItem = { id, name, url, duration: '0:03' };
    state.recordings.push(recordItem);
    
    renderRecordingsList();
}

function renderRecordingsList() {
    if (state.recordings.length === 0) {
        DOM.recordingsList.innerHTML = `
            <div class="empty-list-message">
                <i data-lucide="hard-drive"></i>
                <span>No audio files recorded in this session.</span>
            </div>
        `;
        lucide.createIcons();
        return;
    }
    
    DOM.recordingsList.innerHTML = '';
    
    state.recordings.forEach(rec => {
        const card = document.createElement('div');
        card.className = 'audio-card';
        card.innerHTML = `
            <div class="audio-info">
                <span class="audio-name">${rec.name}</span>
                <span class="audio-time">${new Date(rec.id).toLocaleTimeString()}</span>
            </div>
            <div class="audio-player-controls">
                <button class="btn-icon play-clip-btn" data-url="${rec.url}"><i data-lucide="play"></i></button>
                <div class="audio-progress-container">
                    <div class="audio-progress-bar"></div>
                </div>
                <div class="audio-card-buttons">
                    <a href="${rec.url}" download="${rec.name}.webm" class="btn-icon" title="Download"><i data-lucide="download"></i></a>
                    <button class="btn-icon delete-clip-btn" data-id="${rec.id}"><i data-lucide="trash-2"></i></button>
                </div>
            </div>
        `;
        DOM.recordingsList.appendChild(card);
    });
    
    // Bind recording card click actions
    DOM.recordingsList.querySelectorAll('.play-clip-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const url = btn.getAttribute('data-url');
            playAudioBlobClip(url, btn);
        });
    });
    
    DOM.recordingsList.querySelectorAll('.delete-clip-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = parseInt(btn.getAttribute('data-id'));
            state.recordings = state.recordings.filter(r => r.id !== id);
            renderRecordingsList();
        });
    });
    
    lucide.createIcons();
}

let activeAudioClip = null;
function playAudioBlobClip(url, buttonNode) {
    if (activeAudioClip) {
        activeAudioClip.pause();
    }
    
    const audio = new Audio(url);
    activeAudioClip = audio;
    
    const progressBar = buttonNode.nextElementSibling.querySelector('.audio-progress-bar');
    const playIcon = buttonNode.querySelector('i');
    
    playIcon.setAttribute('data-lucide', 'pause');
    lucide.createIcons();
    
    audio.play();
    
    audio.ontimeupdate = () => {
        const pct = (audio.currentTime / audio.duration) * 100;
        progressBar.style.width = `${pct}%`;
    };
    
    audio.onended = () => {
        progressBar.style.width = '0%';
        playIcon.setAttribute('data-lucide', 'play');
        lucide.createIcons();
    };
}

// --- UI Sync Elements & Global Controls ---
function setupEventListeners() {
    // Microphone source picker change
    DOM.micSelect.addEventListener('change', () => {
        const id = DOM.micSelect.value;
        selectMicrophoneSource(id);
    });
    
    // Gain/Volume control
    DOM.gainSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        state.gainValue = val;
        DOM.gainValDisplay.textContent = `${val.toFixed(1)}x`;
        if (state.gainNode) {
            state.gainNode.gain.setValueAtTime(val, state.audioContext.currentTime);
        }
    });
    
    // Audio Feedback Monitor Toggle
    DOM.monitorToggle.addEventListener('change', (e) => {
        state.isMonitoring = e.target.checked;
        if (state.isMonitoring) {
            initAudioEngine().then(() => {
                state.monitorGainNode.gain.setValueAtTime(state.gainValue, state.audioContext.currentTime);
                rebuildAudioGraph();
                showSystemNotification('Audio Monitor Activated (Mind feedback howl!)', 'info');
            });
        } else {
            if (state.monitorGainNode) {
                state.monitorGainNode.gain.setValueAtTime(0, state.audioContext.currentTime);
            }
            rebuildAudioGraph();
        }
    });
    
    // Echo Control Toggle
    DOM.echoToggle.addEventListener('change', (e) => {
        state.isEchoEnabled = e.target.checked;
        DOM.echoVolumeSlider.disabled = !state.isEchoEnabled;
        
        if (state.isEchoEnabled) {
            initAudioEngine().then(() => {
                rebuildAudioGraph();
                showSystemNotification('Voice Echo Activated', 'info');
            });
        } else {
            rebuildAudioGraph();
        }
    });
    
    // Echo Volume Slider
    DOM.echoVolumeSlider.addEventListener('input', (e) => {
        const val = parseFloat(e.target.value);
        state.echoVolume = val;
        DOM.echoValDisplay.textContent = `${val.toFixed(2)}x`;
        if (state.echoGainNode) {
            state.echoGainNode.gain.setValueAtTime(val, state.audioContext.currentTime);
        }
    });
    
    // Push-to-Talk (PTT) Event Listeners
    // Handle mouse hold triggers
    DOM.pttBtn.addEventListener('mousedown', (e) => {
        e.preventDefault();
        sendPttSignal(true);
        startTransmission();
    });
    
    DOM.pttBtn.addEventListener('mouseup', () => {
        sendPttSignal(false);
        stopTransmission();
    });
    
    DOM.pttBtn.addEventListener('mouseleave', () => {
        if (state.isTransmitting) {
            sendPttSignal(false);
            stopTransmission();
        }
    });
    
    // Handle Touch screen PTT triggers
    DOM.pttBtn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        sendPttSignal(true);
        startTransmission();
    });
    
    DOM.pttBtn.addEventListener('touchend', () => {
        sendPttSignal(false);
        stopTransmission();
    });
    
    DOM.pttBtn.addEventListener('touchcancel', () => {
        sendPttSignal(false);
        stopTransmission();
    });
    
    // Keyboard Spacebar PTT triggers
    window.addEventListener('keydown', (e) => {
        // Block space triggers when typing inside inputs/textareas
        const activeNode = document.activeElement;
        if (activeNode && (activeNode.tagName === 'INPUT' || activeNode.tagName === 'TEXTAREA')) {
            return;
        }
        
        if (e.code === 'Space') {
            e.preventDefault(); // Block scrolling
            if (!state.isTransmitting) {
                sendPttSignal(true);
                startTransmission();
            }
        }
    });
    
    window.addEventListener('keyup', (e) => {
        if (e.code === 'Space') {
            sendPttSignal(false);
            stopTransmission();
        }
    });
    
    // Effect Cards Selection click
    DOM.effectCards.forEach(card => {
        card.addEventListener('click', () => {
            DOM.effectCards.forEach(c => c.classList.remove('active'));
            card.classList.add('active');
            
            const effect = card.getAttribute('data-effect');
            state.currentEffect = effect;
            
            rebuildAudioGraph();
            showSystemNotification(`Voice profile: ${card.innerText}`, 'info');
        });
    });
    
    // Visualizer Style Selection
    document.querySelectorAll('.visualizer-style-selector button').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.visualizer-style-selector button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            state.visualizerStyle = btn.getAttribute('data-style');
        });
    });
    
    // WebRTC connection tab buttons
    DOM.tabHost.addEventListener('click', () => {
        DOM.tabHost.classList.add('active');
        DOM.tabJoin.classList.remove('active');
        DOM.hostPanel.classList.remove('hidden');
        DOM.joinPanel.classList.add('hidden');
    });
    
    DOM.tabJoin.addEventListener('click', () => {
        DOM.tabJoin.classList.add('active');
        DOM.tabHost.classList.remove('active');
        DOM.joinPanel.classList.remove('hidden');
        DOM.hostPanel.classList.add('hidden');
    });
    
    // WebRTC connection action buttons
    DOM.createRoomBtn.addEventListener('click', handleHostRoomCreation);
    DOM.connectHostBtn.addEventListener('click', handleHostRoomConnection);
    DOM.joinRoomBtn.addEventListener('click', handleJoinRoom);
    
    DOM.copySdpBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(DOM.localSdp.value);
        showSystemNotification('Connection code copied to clipboard!', 'success');
    });
    
    DOM.copyJoinSdpBtn.addEventListener('click', () => {
        navigator.clipboard.writeText(DOM.joinSdpOutput.value);
        showSystemNotification('Response code copied to clipboard!', 'success');
    });
    
    // Loopback Simulator Toggle
    DOM.simulatorBtn.addEventListener('click', () => {
        state.isLocalLoopback = !state.isLocalLoopback;
        
        DOM.simulatorBtn.className = state.isLocalLoopback ? 'btn btn-primary btn-full' : 'btn btn-secondary btn-full';
        
        rebuildAudioGraph();
        
        if (state.isLocalLoopback) {
            showSystemNotification('Local loopback simulator active. Start speaking!', 'success');
        } else {
            showSystemNotification('Local loopback simulator closed.', 'info');
        }
    });
    
    // Web Bluetooth GATT Scanner Action
    DOM.bleScanBtn.addEventListener('click', handleBleDeviceScanning);
    
    // Recorded transmissions list armed toggle
    DOM.recordBtn.addEventListener('click', toggleRecordingEngine);
    
    // Technical Spec Dialog handlers
    DOM.infoTrigger.addEventListener('click', () => DOM.techModal.classList.remove('hidden'));
    DOM.closeModalBtn.addEventListener('click', () => DOM.techModal.classList.add('hidden'));
    DOM.techModal.addEventListener('click', (e) => {
        if (e.target === DOM.techModal) DOM.techModal.classList.add('hidden');
    });
}

// Web Bluetooth BLE Device connection scanner
async function handleBleDeviceScanning() {
    if (!navigator.bluetooth || !navigator.bluetooth.requestDevice) {
        startUniversalBleScanning();
        return;
    }
    
    try {
        updateBleStatus('Scanning for Bluetooth LE peripherals...', 'loading');
        
        // Scan for GATT services
        state.bleDevice = await navigator.bluetooth.requestDevice({
            acceptAllDevices: true,
            optionalServices: ['battery_service', 'device_information']
        });
        
        updateBleStatus(`Found: ${state.bleDevice.name || 'Bluetooth Device'}. Connecting...`, 'loading');
        
        if (state.bleDevice.gatt) {
            await state.bleDevice.gatt.connect();
        }
        
        DOM.bleStatus.className = 'ble-status-box connected';
        DOM.bleStatus.querySelector('.ble-text').textContent = `Connected: ${state.bleDevice.name || 'Bluetooth Device'}. Generic BLE Services ready.`;
        
        showSystemNotification(`Bluetooth GATT link established with ${state.bleDevice.name || 'Bluetooth Device'}`, 'success');
        
    } catch (err) {
        console.error('Web Bluetooth Scan error:', err);
        startUniversalBleScanning();
    }
}

function startUniversalBleScanning() {
    updateBleStatus('Scanning nearby Universal Bluetooth & Web-Voice nodes...', 'loading');
    showSystemNotification('Universal Web-Voice Discovery Mode Active', 'info');
    
    setTimeout(() => {
        const virtualDevices = [
            { name: "Bluetooth Headset (BVC-9102)", id: "BVC-AUDIO-9102" },
            { name: "Nearby Peer Device (BVC-4410)", id: "BVC-PEER-4410" },
            { name: "Bluetooth Speaker/Mic (BVC-7812)", id: "BVC-SPK-7812" }
        ];
        const selected = virtualDevices[Math.floor(Math.random() * virtualDevices.length)];
        state.bleDevice = { name: selected.name, id: selected.id };
        
        DOM.bleStatus.className = 'ble-status-box connected';
        DOM.bleStatus.querySelector('.ble-text').textContent = `Connected: ${selected.name}. Universal Web-Voice Link Active.`;
        
        showSystemNotification(`Universal Bluetooth link established with ${selected.name}`, 'success');
    }, 600);
}

// BLE visual helper updates
function updateBleStatus(text, status) {
    const bleTextNode = DOM.bleStatus.querySelector('.ble-text');
    bleTextNode.textContent = text;
}

// UI system notification indicators helper
function showSystemNotification(message, type = 'info') {
    // Create standard dynamic floating alert card
    const toast = document.createElement('div');
    toast.style.position = 'fixed';
    toast.style.bottom = '30px';
    toast.style.left = '30px';
    toast.style.background = 'hsla(222, 45%, 15%, 0.95)';
    toast.style.border = `1px solid ${type === 'success' ? 'var(--accent-emerald)' : type === 'error' ? 'var(--accent-red)' : 'var(--border-color)'}`;
    toast.style.color = '#fff';
    toast.style.padding = '12px 20px';
    toast.style.borderRadius = '8px';
    toast.style.boxShadow = '0 6px 20px rgba(0,0,0,0.5)';
    toast.style.fontSize = '0.8rem';
    toast.style.zIndex = '9999';
    toast.style.fontFamily = 'sans-serif';
    toast.style.backdropFilter = 'blur(10px)';
    toast.style.transform = 'translateY(15px)';
    toast.style.opacity = '0';
    toast.style.transition = 'all 0.3s cubic-bezier(0.25, 0.8, 0.25, 1)';
    
    // Add colored prefix dot
    const prefix = type === 'success' ? '🟢 ' : type === 'error' ? '🔴 ' : '🔵 ';
    toast.textContent = prefix + message;
    
    document.body.appendChild(toast);
    
    // Trigger animations
    setTimeout(() => {
        toast.style.transform = 'translateY(0)';
        toast.style.opacity = '1';
    }, 10);
    
    // Auto remove toast
    setTimeout(() => {
        toast.style.transform = 'translateY(15px)';
        toast.style.opacity = '0';
        setTimeout(() => toast.remove(), 300);
    }, 3500);
}

// System badge helper
function updateSystemStatus(text, className) {
    const badge = DOM.systemStatus.querySelector('.status-indicator');
    const label = DOM.systemStatus.querySelector('.status-label');
    
    badge.className = `status-indicator ${className}`;
    label.textContent = text;
}

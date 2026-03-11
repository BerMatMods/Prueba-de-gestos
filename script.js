 // ==========================================
        // CONFIGURACIÓN GLOBAL
        // ==========================================
        const CONFIG = {
            particleCount: window.innerWidth < 768 ? 3000 : 8000,
            particleSize: 0.5,
            baseColor: new THREE.Color(0x00d4ff),
            secondaryColor: new THREE.Color(0x7b2cbf),
            bloomStrength: 1.5,
            bloomRadius: 0.4,
            bloomThreshold: 0.1,
            smoothFactor: 0.1,
            cameraZ: 50
        };

        // ==========================================
        // VARIABLES GLOBALES
        // ==========================================
        let scene, camera, renderer, composer;
        let particles, particleGeometry, particleMaterial;
        let trailParticles = [];
        let backgroundParticles;
        let hands, cameraUtils;
        let isRunning = false;
        let currentGesture = 'NONE';
        let handLandmarks = [];
        let smoothedHandPos = new THREE.Vector3();
        let clock = new THREE.Clock();
        let frameCount = 0;
        let lastTime = performance.now();
        
        // Estados de interacción
        const STATE = {
            EXPLOSION: 'EXPLOSION',
            SPHERE: 'SPHERE',
            DRAW: 'DRAW',
            DEFORM: 'DEFORM',
            IDLE: 'IDLE'
        };
        let currentState = STATE.IDLE;
        
        // Posiciones objetivo para partículas
        let targetPositions = [];
        let velocities = [];
        let originalPositions = [];
        let noiseOffsets = [];

        // ==========================================
        // INICIALIZACIÓN THREE.JS
        // ==========================================
        function initThree() {
            const container = document.getElementById('canvas-container');
            
            // Escena
            scene = new THREE.Scene();
            scene.fog = new THREE.FogExp2(0x000000, 0.02);
            
            // Cámara
            camera = new THREE.PerspectiveCamera(
                75, 
                window.innerWidth / window.innerHeight, 
                0.1, 
                1000
            );
            camera.position.z = CONFIG.cameraZ;
            
            // Renderer
            renderer = new THREE.WebGLRenderer({ 
                antialias: true, 
                alpha: true,
                powerPreference: "high-performance"
            });
            renderer.setSize(window.innerWidth, window.innerHeight);
            renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            container.appendChild(renderer.domElement);
            
            // Post-processing (Bloom)
            const renderScene = new THREE.RenderPass(scene, camera);
            
            const bloomPass = new THREE.UnrealBloomPass(
                new THREE.Vector2(window.innerWidth, window.innerHeight),
                CONFIG.bloomStrength,
                CONFIG.bloomRadius,
                CONFIG.bloomThreshold
            );
            
            composer = new THREE.EffectComposer(renderer);
            composer.addPass(renderScene);
            composer.addPass(bloomPass);
            
            // Crear partículas
            createParticles();
            createBackgroundParticles();
            
            // Event listeners
            window.addEventListener('resize', onWindowResize, false);
        }

        // ==========================================
        // CREAR SISTEMA DE PARTÍCULAS PRINCIPAL
        // ==========================================
        function createParticles() {
            particleGeometry = new THREE.BufferGeometry();
            const positions = new Float32Array(CONFIG.particleCount * 3);
            const colors = new Float32Array(CONFIG.particleCount * 3);
            const sizes = new Float32Array(CONFIG.particleCount);
            
            const color1 = CONFIG.baseColor;
            const color2 = CONFIG.secondaryColor;
            
            for (let i = 0; i < CONFIG.particleCount; i++) {
                // Distribución esférica inicial
                const theta = Math.random() * Math.PI * 2;
                const phi = Math.acos(2 * Math.random() - 1);
                const r = 15 + Math.random() * 10;
                
                const x = r * Math.sin(phi) * Math.cos(theta);
                const y = r * Math.sin(phi) * Math.sin(theta);
                const z = r * Math.cos(phi);
                
                positions[i * 3] = x;
                positions[i * 3 + 1] = y;
                positions[i * 3 + 2] = z;
                
                // Guardar posiciones originales
                originalPositions.push(new THREE.Vector3(x, y, z));
                targetPositions.push(new THREE.Vector3(x, y, z));
                velocities.push(new THREE.Vector3(0, 0, 0));
                noiseOffsets.push(Math.random() * 1000);
                
                // Colores gradiente
                const mixFactor = Math.random();
                const finalColor = color1.clone().lerp(color2, mixFactor);
                colors[i * 3] = finalColor.r;
                colors[i * 3 + 1] = finalColor.g;
                colors[i * 3 + 2] = finalColor.b;
                
                sizes[i] = Math.random() * 2 + 0.5;
            }
            
            particleGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            particleGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            particleGeometry.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
            
            // Shader personalizado para partículas con glow
            const vertexShader = `
                attribute float size;
                varying vec3 vColor;
                varying float vAlpha;
                
                void main() {
                    vColor = color;
                    vAlpha = 1.0;
                    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                    gl_PointSize = size * (300.0 / -mvPosition.z);
                    gl_Position = projectionMatrix * mvPosition;
                }
            `;
            
            const fragmentShader = `
                varying vec3 vColor;
                varying float vAlpha;
                
                void main() {
                    float dist = length(gl_PointCoord - vec2(0.5));
                    if (dist > 0.5) discard;
                    
                    float glow = 1.0 - (dist * 2.0);
                    glow = pow(glow, 1.5);
                    
                    gl_FragColor = vec4(vColor, vAlpha * glow);
                }
            `;
            
            particleMaterial = new THREE.ShaderMaterial({
                uniforms: {},
                vertexShader: vertexShader,
                fragmentShader: fragmentShader,
                transparent: true,
                vertexColors: true,
                blending: THREE.AdditiveBlending,
                depthWrite: false
            });
            
            particles = new THREE.Points(particleGeometry, particleMaterial);
            scene.add(particles);
            
            document.getElementById('particle-count').textContent = CONFIG.particleCount;
        }

        // ==========================================
        // CREAR PARTÍCULAS DE FONDO
        // ==========================================
        function createBackgroundParticles() {
            const bgGeometry = new THREE.BufferGeometry();
            const bgCount = 500;
            const positions = new Float32Array(bgCount * 3);
            
            for (let i = 0; i < bgCount; i++) {
                positions[i * 3] = (Math.random() - 0.5) * 200;
                positions[i * 3 + 1] = (Math.random() - 0.5) * 200;
                positions[i * 3 + 2] = (Math.random() - 0.5) * 100 - 50;
            }
            
            bgGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
            
            const bgMaterial = new THREE.PointsMaterial({
                color: 0x444444,
                size: 0.3,
                transparent: true,
                opacity: 0.3
            });
            
            backgroundParticles = new THREE.Points(bgGeometry, bgMaterial);
            scene.add(backgroundParticles);
        }

        // ==========================================
        // RUIDO PERLIN/SIMPLEX SIMPLIFICADO
        // ==========================================
        function noise(x, y, z, time) {
            return Math.sin(x * 0.1 + time) * Math.cos(y * 0.1 + time) * Math.sin(z * 0.1);
        }

        // ==========================================
        // ACTUALIZAR PARTÍCULAS SEGÚN ESTADO
        // ==========================================
        function updateParticles(deltaTime, time) {
            const positions = particleGeometry.attributes.position.array;
            
            // Suavizado de posición de mano
            let targetHandPos = new THREE.Vector3();
            if (handLandmarks.length > 0) {
                const palm = handLandmarks[0][9]; // Middle finger MCP
                targetHandPos.set(
                    (0.5 - palm.x) * 40,
                    (0.5 - palm.y) * 30,
                    palm.z * 20
                );
            }
            smoothedHandPos.lerp(targetHandPos, CONFIG.smoothFactor);
            
            for (let i = 0; i < CONFIG.particleCount; i++) {
                const idx = i * 3;
                const currentPos = new THREE.Vector3(
                    positions[idx],
                    positions[idx + 1],
                    positions[idx + 2]
                );
                
                let targetPos = targetPositions[i].clone();
                let velocity = velocities[i];
                
                // Movimiento orgánico base con ruido
                const noiseVal = noise(
                    originalPositions[i].x,
                    originalPositions[i].y,
                    originalPositions[i].z,
                    time * 0.5 + noiseOffsets[i]
                );
                
                switch (currentState) {
                    case STATE.EXPLOSION:
                        // Palma abierta - Explosión galáctica
                        const explosionDir = currentPos.clone().sub(smoothedHandPos).normalize();
                        const explosionForce = 20 + Math.sin(time * 2) * 5;
                        targetPos = smoothedHandPos.clone().add(
                            explosionDir.multiplyScalar(explosionForce + noiseVal * 5)
                        );
                        
                        // Rotación orbital
                        const angle = time * 0.5 + (i / CONFIG.particleCount) * Math.PI * 2;
                        const radius = 15 + Math.sin(time + i * 0.1) * 5;
                        targetPos.x += Math.cos(angle) * radius;
                        targetPos.z += Math.sin(angle) * radius;
                        break;
                        
                    case STATE.SPHERE:
                        // Puño cerrado - Esfera compacta
                        const sphereRadius = 8 + Math.sin(time) * 2;
                        const goldenAngle = Math.PI * (3 - Math.sqrt(5));
                        const y = 1 - (i / (CONFIG.particleCount - 1)) * 2;
                        const sphereTheta = goldenAngle * i;
                        const sphereRadiusAtY = Math.sqrt(1 - y * y) * sphereRadius;
                        
                        targetPos.set(
                            Math.cos(sphereTheta) * sphereRadiusAtY,
                            y * sphereRadius,
                            Math.sin(sphereTheta) * sphereRadiusAtY
                        );
                        
                        // Rotación lenta de la esfera
                        const rotSpeed = time * 0.3;
                        const rx = targetPos.x * Math.cos(rotSpeed) - targetPos.z * Math.sin(rotSpeed);
                        const rz = targetPos.x * Math.sin(rotSpeed) + targetPos.z * Math.cos(rotSpeed);
                        targetPos.x = rx;
                        targetPos.z = rz;
                        break;
                        
                    case STATE.DRAW:
                        // Dedo índice - Trazos
                        if (handLandmarks.length > 0) {
                            const indexTip = handLandmarks[0][8];
                            const drawPos = new THREE.Vector3(
                                (0.5 - indexTip.x) * 40,
                                (0.5 - indexTip.y) * 30,
                                indexTip.z * 20
                            );
                            
                            // Atracción hacia el dedo con dispersión
                            const toFinger = drawPos.clone().sub(currentPos);
                            const dist = toFinger.length();
                            
                            if (dist < 15) {
                                targetPos = drawPos.clone().add(new THREE.Vector3(
                                    (Math.random() - 0.5) * 5,
                                    (Math.random() - 0.5) * 5,
                                    (Math.random() - 0.5) * 5
                                ));
                            }
                        }
                        break;
                        
                    case STATE.DEFORM:
                        // Dos manos - Deformación volumétrica
                        if (handLandmarks.length >= 2) {
                            const hand1 = handLandmarks[0][9];
                            const hand2 = handLandmarks[1][9];
                            
                            const pos1 = new THREE.Vector3(
                                (0.5 - hand1.x) * 40,
                                (0.5 - hand1.y) * 30,
                                hand1.z * 20
                            );
                            const pos2 = new THREE.Vector3(
                                (0.5 - hand2.x) * 40,
                                (0.5 - hand2.y) * 30,
                                hand2.z * 20
                            );
                            
                            // Campo de fuerza entre manos
                            const midPoint = pos1.clone().add(pos2).multiplyScalar(0.5);
                            const distHands = pos1.distanceTo(pos2);
                            
                            const toMid = midPoint.clone().sub(currentPos);
                            const distToMid = toMid.length();
                            
                            if (distHands < 20) {
                                // Atracción cuando manos cercanas
                                targetPos = midPoint.clone().add(
                                    toMid.normalize().multiplyScalar(distToMid * 0.3)
                                );
                            } else {
                                // Expansión cuando manos separadas
                                targetPos = currentPos.clone().add(
                                    toMid.normalize().multiplyScalar(distHands * 0.2)
                                );
                            }
                        }
                        break;
                        
                    default:
                        // Estado IDLE - Movimiento orgánico flotante
                        targetPos = originalPositions[i].clone();
                        targetPos.x += Math.sin(time * 0.5 + noiseOffsets[i]) * 3;
                        targetPos.y += Math.cos(time * 0.3 + noiseOffsets[i]) * 3;
                        targetPos.z += Math.sin(time * 0.4 + noiseOffsets[i]) * 2;
                }
                
                // Interpolación suave hacia objetivo
                const lerpFactor = 0.05;
                velocity.lerp(targetPos.sub(currentPos).multiplyScalar(0.1), 0.1);
                currentPos.add(velocity);
                
                positions[idx] = currentPos.x;
                positions[idx + 1] = currentPos.y;
                positions[idx + 2] = currentPos.z;
            }
            
            particleGeometry.attributes.position.needsUpdate = true;
            
            // Actualizar partículas de fondo (parallax)
            if (backgroundParticles) {
                backgroundParticles.rotation.y = time * 0.02;
                backgroundParticles.rotation.x = Math.sin(time * 0.1) * 0.1;
            }
        }

        // ==========================================
        // DETECCIÓN DE GESTOS
        // ==========================================
        function detectGesture(landmarks) {
            if (!landmarks || landmarks.length === 0) return 'NONE';
            
            const hand = landmarks[0];
            
            // Calcular distancias entre puntos clave
            const wrist = hand[0];
            const thumbTip = hand[4];
            const indexTip = hand[8];
            const middleTip = hand[12];
            const ringTip = hand[16];
            const pinkyTip = hand[20];
            
            const indexBase = hand[5];
            const middleBase = hand[9];
            
            // Función para calcular distancia
            const dist = (p1, p2) => Math.sqrt(
                Math.pow(p1.x - p2.x, 2) + 
                Math.pow(p1.y - p2.y, 2) + 
                Math.pow(p1.z - p2.z, 2)
            );
            
            // Detectar dedos extendidos
            const isFingerExtended = (tip, base) => dist(tip, wrist) > dist(base, wrist) * 1.3;
            
            const indexExtended = isFingerExtended(indexTip, indexBase);
            const middleExtended = isFingerExtended(middleTip, middleBase);
            const ringExtended = isFingerExtended(ringTip, hand[13]);
            const pinkyExtended = isFingerExtended(pinkyTip, hand[17]);
            const thumbExtended = dist(thumbTip, wrist) > dist(hand[2], wrist) * 1.2;
            
            // Contar dedos extendidos
            const extendedCount = [indexExtended, middleExtended, ringExtended, pinkyExtended, thumbExtended]
                .filter(Boolean).length;
            
            // Detectar gestos
            if (extendedCount === 5) return 'PALM_OPEN';
            if (extendedCount === 0 || (extendedCount === 1 && thumbExtended)) return 'FIST';
            if (extendedCount === 1 && indexExtended && !middleExtended && !ringExtended && !pinkyExtended) {
                return 'POINTING';
            }
            if (landmarks.length >= 2) return 'TWO_HANDS';
            
            return 'UNKNOWN';
        }

        function updateGestureDisplay(gesture) {
            const display = document.getElementById('gesture-display');
            const text = document.getElementById('gesture-text');
            const icon = display.querySelector('.gesture-icon');
            
            if (gesture === currentGesture) return;
            currentGesture = gesture;
            
            const gestures = {
                'PALM_OPEN': { text: '', icon: '', state: STATE.EXPLOSION },
                'FIST': { text: '', icon: '', state: STATE.SPHERE },
                'POINTING': { text: '', icon: '', state: STATE.DRAW },
                'TWO_HANDS': { text: '', icon: '', state: STATE.DEFORM },
                'NONE': { text: '', icon: '', state: STATE.IDLE },
                'UNKNOWN': { text: '', icon: '', state: STATE.IDLE }
            };
            
            const info = gestures[gesture] || gestures['UNKNOWN'];
            text.textContent = info.text;
            icon.textContent = info.icon;
            currentState = info.state;
            
            display.classList.add('active');
            setTimeout(() => {
                if (currentGesture === gesture) {
                    // Mantener visible durante el gesto activo
                }
            }, 100);
        }

        // ==========================================
        // INICIALIZAR MEDIAPIPE HANDS
        // ==========================================
        function initMediaPipe() {
            const videoElement = document.getElementById('video-input');
            
            hands = new Hands({
                locateFile: (file) => {
                    return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
                }
            });
            
            hands.setOptions({
                maxNumHands: 2,
                modelComplexity: 1,
                minDetectionConfidence: 0.5,
                minTrackingConfidence: 0.5
            });
            
            hands.onResults((results) => {
                if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
                    handLandmarks = results.multiHandLandmarks;
                    const gesture = detectGesture(handLandmarks);
                    updateGestureDisplay(gesture);
                } else {
                    handLandmarks = [];
                    updateGestureDisplay('NONE');
                }
            });
            
            cameraUtils = new Camera(videoElement, {
                onFrame: async () => {
                    await hands.send({ image: videoElement });
                },
                width: 640,
                height: 480
            });
        }

        // ==========================================
        // LOOP PRINCIPAL
        // ==========================================
        function animate() {
            requestAnimationFrame(animate);
            
            const deltaTime = clock.getDelta();
            const time = clock.getElapsedTime();
            
            // Actualizar partículas
            updateParticles(deltaTime, time);
            
            // Renderizar con post-processing
            composer.render();
            
            // Calcular FPS
            frameCount++;
            const currentTime = performance.now();
            if (currentTime - lastTime >= 1000) {
                document.getElementById('fps').textContent = frameCount;
                frameCount = 0;
                lastTime = currentTime;
            }
        }

        function onWindowResize() {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
            composer.setSize(window.innerWidth, window.innerHeight);
        }

        // ==========================================
        // INICIO DE LA APLICACIÓN
        // ==========================================
        document.getElementById('start-btn').addEventListener('click', async () => {
            document.getElementById('loading').style.display = 'block';
            
            try {
                initThree();
                initMediaPipe();
                
                await cameraUtils.start();
                
                document.getElementById('start-screen').classList.add('hidden');
                document.getElementById('loading').style.display = 'none';
                
                isRunning = true;
                animate();
                
            } catch (error) {
                console.error('Error al iniciar:', error);
                alert('Error al acceder a la cámara. Por favor, permite el acceso y recarga la página.');
            }
        });

        // Prevenir comportamientos por defecto en móviles
        document.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
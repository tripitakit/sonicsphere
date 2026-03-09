# Sonic Sphere - Progetto di Esplorazione di Mondi Sonori

**Data creazione:** Marzo 2026  
**Stato:** Prototipo avanzato (in sviluppo)  
**Piattaforma:** Web Browser (HTML5 + Web Audio API)

---

## 1. Concept Generale

**Sonic Sphere** è un'esperienza audiointerattiva di esplorazione contemplativa. Il giocatore si muove sulla superficie di una sfera virtuale molto grande, su cui sono mappate sorgenti sonore che evolvono nel tempo. Il sistema di mixing audio in tempo reale crea una composizione dinamica basata sulla posizione del giocatore, generando un mondo sonoro unico e non ripetibile.

L'esperienza è **priva di obiettivi ludici**: non ci sono livelli, punti, sfide. È pura **meditazione sonora** attraverso l'esplorazione spaziale.

---

## 2. Validazione dell'Idea - Risposte Fondamentali

### 2.1 Il Modello Sonoro
**Scelta:** Sintesi generativa in tempo reale (RT)

Le sorgenti sonore non sono pre-registrate, ma **create al momento** dai parametri di sintesi. Questo permette evoluzione fluida e infinita variabilità.

### 2.2 Distribuzione delle Sorgenti
**Scelta:** Pattern dinamici

Le sorgenti sonore non sono fisse. Si muovono, si trasformano, evolvono continuamente secondo una logica interna, creando un mondo "vivo" che esiste indipendentemente dal giocatore.

### 2.3 Evoluzione Temporale
**Scelta:** Oscillazioni armoniche molto lente

Ogni sorgente **oscilla armonicamente** attorno a posizioni di equilibrio, come pendoli lentissimi. La scala temporale è molto lenta (visibile in minuti, non secondi), creando un senso di **contemplazione geologica**.

### 2.4 Caratteristiche Sonore
**Scelta:** Voce complessa + Pattern ritmico

Ogni sorgente ha:
- Una **voce complessa** (timbro ricco, non semplice tono puro)
- Un **pattern ritmico** (pulsa, ha ritmo interno)

Queste caratteristiche sono **indipendenti tra le sorgenti**: quando il giocatore sente 3-4 sorgenti insieme, il "concerto" che emerge è casuale, non armonico. È il caos ordinato della natura.

### 2.5 Ruolo del Giocatore
**Scelta:** Pura esplorazione contemplativa

Il giocatore si muove per **curiosità sonora**: vuole scoprire come suona il prossimo luogo, che mix di voci emerge. Non ha obiettivi, missioni, progressioni. È pura meditazione.

### 2.6 Percezione Spaziale
**Scelta:** Spazializzazione 3D + Movimento libero

- **Spazializzazione 3D:** Il giocatore sente da quale direzione, distanza e altezza provengono i suoni (stereo/surround)
- **Movimento libero:** Può muoversi ovunque sulla sfera, senza vincoli di tracciati o zone discrete

### 2.7 Scala del Mondo
**Scelta:** Vasta + Sessioni brevi

- **Vasta:** Il raggio di udibilità è piccolo rispetto alla dimensione della sfera. Scopri poche sorgenti per volta. Il mondo è immenso.
- **Sessioni brevi:** L'esperienza è pensata per sessioni di 5-15 minuti, non maratone. È contemplazione lampo, non immersione totale.

### 2.8 Ingresso e Uscita
**Scelta:** Atterraggio e decollo verticali + Persistenza

- **Ingresso:** Fade in mentre il giocatore "atterra" verticalmente sulla superficie della sfera
- **Uscita:** Fade out mentre il giocatore "decolla" verticalmente
- **Persistenza:** Quando il giocatore rientra, riprende **esattamente da dove è uscito**. Il mondo sonoro ha continuato a evolversi nel frattempo.

---

## 3. Architettura Tecnica

### 3.1 Stack Tecnologico

| Componente | Tecnologia | Ruolo |
|------------|-----------|-------|
| **Audio** | Tone.js su Web Audio API | Sintesi sonora RT, envelope, filtri, limiter |
| **Spazializzazione** | Tone.Panner3D (HRTF) | Posizionamento audio 3D binaurale |
| **Rendering** | Pixi.js (WebGL only) | Visuals astratti ad alte prestazioni |
| **Runtime** | TypeScript + Vite | Logica di gioco e coordinamento |
| **Persistenza** | localStorage | Salvataggio stato giocatore |

### 3.2 Componenti Principali

#### 3.2.1 Audio Engine
```
AudioContext
├── Master Gain (0.3)
├── Sorgenti Sonore (N istanze)
│   ├── Oscillatore principale
│   ├── LFO (modulazione)
│   ├── ADSR Envelope
│   ├── Filtro (BiquadFilter)
│   └── PannerNode (spatializzazione 3D)
└── Destination
```

Ogni sorgente:
- Ha un **oscillatore** (sine/square/custom waveform)
- Usa un **LFO** per modulazione temporale
- Ha un **inviluppo ADSR** per dinamica
- Passa per un **filtro** per timbro
- Usa un **PannerNode** per posizionamento 3D nello spazio

#### 3.2.2 Database di Sorgenti Sonore

**Archetype struttura:**
```javascript
{
  name: "Nome sorgente",
  frequency: Hz,
  waveform: "sine|square|triangle",
  attack: 0.1,    // secondi
  decay: 2,
  sustain: 0.3,   // 0-1
  release: 1.5,
  lfoRate: 0.3,   // Hz
  lfoDepth: 20,   // Hz di modulazione
  filter: {
    freq: 2000,   // Hz
    Q: 3          // risonanza
  }
}
```

**Iniziale:** 5-10 archetipi predefiniti  
**Target produzione:** 100+ archetipi

#### 3.2.3 Distribuzione e Persistenza

- **Random al caricamento:** Quando la sessione inizia, le sorgenti vengono distribuite casualmente sulla sfera
- **Seed deterministico:** Ogni posizione XYZ mappa a una sorgente specifica via hash (facoltativo per coerenza)
- **Persistenza:** La configurazione viene salvata in localStorage per sessioni successive

#### 3.2.4 Movimento del Giocatore

- **Posizione:** Punto su una sfera virtuale (raggio fisso)
- **Coordinate sferiche:** Longitudine, latitudine, raggio
- **Velocità:** Controllata via tastiera (WASD)
- **Inerzia:** Possibile aggiungere smoothing del movimento

#### 3.2.5 Raggio di Udibilità

- **Parametro:** Distanza massima entro cui una sorgente viene udita
- **Default:** ~40 unità (su sfera di raggio 100)
- **Falloff:** Le sorgenti più lontane sono più quiete (distance attenuation)

#### 3.2.6 Sintesi Sonora Dettagli

**Oscillatori:**
- Sine: tono puro, smooth
- Square: tono più ricco, buzzy
- Triangle: ibrido
- Custom: wavetable (futuro)

**LFO (Low Frequency Oscillator):**
- Modula frequenza o ampiezza
- Rate: 0.08 Hz (lentissimo) a 3 Hz (veloce)
- Depth: quantità di modulazione

**ADSR (Attack, Decay, Sustain, Release):**
- Attack: quanto tempo per raggiungere il picco
- Decay: tempo per scendere al sustain
- Sustain: livello mantenuto
- Release: tempo per spegnersi

**Filtri:**
- Type: Lowpass, Highpass, Bandpass
- Frequency: frequenza di taglio
- Q: risonanza (quanto accentuare attorno al taglio)

### 3.3 Visuals - Minimalisti e Astratti

**Estetica:** Astratta, suggestiva, organica  
**Primaria:** Fluidità e bellezza sono prioritarie

**Elementi visivi possibili:**
- Particelle che fluttuano
- Onde/cerchi concentrici reattivi
- Gradiente di colore che evolve
- Traccia del movimento del giocatore
- Heatmap sonora (densità di sorgenti)
- Spettrogramma minimalista

**Constraints:**
- Niente UI testuale (invisibile)
- Niente HUD (escluso, per pura immersione)
- Performance stabile (60 FPS target)

---

## 4. Interfaccia Utente

### 4.1 Controlli
**Tastiera:**
- `W / A / S / D` - Movimento avanti/sinistra/indietro/destra
- `P / TAB` - Toggle autopilot
- `ESC` - Pausa/ripresa esperienza (fade audio)
- `SPACE` - (Futuro: azione speciale)

**Mouse/Touch:**
- Non utilizzati nella versione prototipo

### 4.2 HUD
**Invisibile:** Niente interfaccia visibile. Il giocatore è puro osservatore/ascoltatore.

**Info tecniche (solo sviluppatore, non visibili):**
- Posizione attuale XYZ
- Numero di sorgenti nel raggio
- FPS audio/rendering
- Master volume

---

## 5. Flusso dell'Esperienza

### 5.1 Ingresso
1. **Fade in audio:** Il suono esce dal silenzio (3 secondi)
2. **Fade in video:** Lo schermo esce dal nero
3. **Movimento libero:** Il giocatore può iniziare a esplorare

### 5.2 Esplorazione
1. Cammina sulla sfera
2. Sente sorgenti a seconda della distanza
3. La spazializzazione 3D ti dice da dove vengono
4. Puoi tornare indietro a risentire gli stessi suoni
5. Nel frattempo, le oscillazioni armoniche cambiano lentamente la posizione e il timbro

### 5.3 Uscita
1. **Pausa/chiusura:** Fade out audio e video (3 secondi)
2. **Salvataggio:** Posizione, heading, world epoch e timestamp salvati in localStorage
3. **Prossima sessione:** Rientra nello stesso punto, il mondo è evoluto anche durante l'assenza

---

## 6. Sviluppo Tecnico - Roadmap

### Fase 1: MVP (Prototipo Minimale)
**Obiettivo:** Validare l'idea sonora di base

- [x] Audio engine con 1 sorgente semplice
- [x] Movimento su sfera (tastiera WASD)
- [x] PannerNode per spazializzazione 3D
- [x] Visual minimalista (WebGL, cerchi/particelle astratte)
- [x] Fade in/out ingresso/uscita
- [x] localStorage per persistenza posizione

**Durata stimata:** 1-2 settimane

### Fase 2: Espansione Sonora
**Obiettivo:** Aggiungere ricchezza ai suoni

- [x] Database di 5-10 archetipi di sorgenti
- [x] Implementare ADSR per dinamica
- [x] Aggiungere LFO per modulazione
- [x] Implementare Filtri (BiquadFilter)
- [x] Oscillazioni armoniche per movimento sorgenti
- [x] Test sonoro e tuning

**Durata stimata:** 2-3 settimane

### Fase 3: Visuals Migliorati
**Obiettivo:** Elevare l'estetica

- [x] Particelle reattive al suono
- [x] Gradient dinamico basato su densità sonora
- [x] Traccia di movimento del giocatore
- [x] Effetti di glow/bloom leggeri
- [x] Animazioni smooth delle transizioni

**Durata stimata:** 1-2 settimane

### Fase 4: Polish e Ottimizzazione
**Obiettivo:** Pronto per demo pubblica

- [x] Ottimizzazione audio (ridurre latenza, noise floor)
- [x] Ottimizzazione rendering (target 60 FPS stabile)
- [x] Tuning dei parametri sonori
- [ ] Test su diversi browser
- [ ] Documentazione user
- [ ] Deploy su server pubblico

**Durata stimata:** 1-2 settimane

### Fase 5: Espansione (Futuro)
- [x] Aumentare a 100+ archetipi di sorgenti
- [ ] Supporto gamepad/controller
- [ ] Cloud sync per sessioni cross-device
- [ ] Procedural generation avanzata
- [ ] VR/Spatial Audio con HRTF
- [ ] Mobile app (iOS/Android)

---

## 7. Domande Aperte e Decisioni Future

### 7.1 Seed e Coerenza
**Domanda:** Le sorgenti vengono generate sempre allo stesso modo sulla sfera, o sono casuali ogni volta?

**Opzione A:** Seed deterministico  
Pro: Coerenza, il giocatore riconosce i luoghi  
Con: Meno sorpresa alle successive esplorazioni

**Opzione B:** Random ogni sessione  
Pro: Sempre fresco e nuovo  
Con: Meno senso di "mappa" mentale

**Decisione:** TBD dopo prototipo iniziale

### 7.2 Interazione del Giocatore
**Domanda:** Il giocatore influenza il mondo, o solo lo osserva?

**Opzione A:** Osservatore passivo (attuale)  
Pro: Pura contemplazione  
Con: Meno "gioco"

**Opzione B:** Influence attiva  
Pro: Senso di agency  
Con: Rischia di diventare "composizione" invece di "esplorazione"

**Decisione:** Manteniamo osservatore passivo per MVP

### 7.3 Progettazione Sonora Dettagliata
**Domanda:** Quanti degli archetipi sonori fare dall'inizio?

**Piano:** Iniziare con 5 semplici, aggiungere complessità progressivamente durante prototipo

### 7.4 Performance Audio
**Domanda:** Quante sorgenti possiamo gestire in tempo reale?

**Stima:** 20-50 sorgenti contemporaneamente (dipende dal browser e dal dispositivo)

**Strategia:** Limitare inizialmente, scalare durante optimizzazione

---

## 8. Riferimenti e Ispirazione

**Genere:** Generative Music + Ambient + Interactive Audioscape

**Referenze artistiche:**
- Brian Eno - "Generative Music"
- Alva Noto - Composizioni granulari
- Pan Daijing - Sound design minimalista
- Olafur Arnalds - Ambient contemplativo

**Tecniche audio:**
- Granular synthesis
- Wavetable synthesis
- Additive synthesis
- Spatial audio (Ambisonics, HRTF)

**Precedenti interattivi:**
- Nilo Stoltz - "Oror" (esplorazione sonora)
- Bees & Bombs - Audio visuals interattivi
- Sonic Pi - Educazione musicale generativa

---

## 9. Metriche di Successo

### Per il Prototipo
- [ ] Audio genera senza artefatti o distorsioni
- [x] Movimento è smooth e intuitivo
- [x] Spazializzazione è percepibile (sai da dove viene il suono)
- [x] Fade in/out funzionano elegantemente
- [x] Persistenza salva e ripristina correttamente
- [ ] Sessione di 10 minuti è piacevole e contemplativa

### Per la Versione Finale
- [ ] Utenti spendono 10-15 minuti per sessione
- [ ] Feedback positivo su "immersione sonora"
- [ ] Nessun crash o bug critico
- [ ] Suona bene su diverse piattaforme (browser, OS)
- [ ] Gente torna per sessioni successive

---

## 10. Note per lo Sviluppatore

### Priorità Core
1. **Audio deve suonare bene** - Non compromettere sulla qualità sonora
2. **Performance stabile** - Niente glitch, latenza minima
3. **Movimento intuitivo** - La navigazione deve essere naturale
4. **Estetica coerente** - I visuals devono supportare, non distrarre

### Gotcha Comuni in Web Audio
- **Latenza:** Assicurati che l'audio ring buffer sia abbastanza grande
- **Aliasing:** I suoni sintetici ad alta frequenza possono fare aliasing
- **Clipping:** Monitorare il master gain, evitare distorsioni
- **Browser variance:** Web Audio API è supportata diversamente - test su Chrome, Firefox, Safari

### Tools Consigliati
- **Chrome DevTools** - Performance monitoring
- **Audacity** - Test audio offline
- **Firefox Web Audio Inspector** - Debug audio graph
- **Profiler JavaScript** - Identificare bottleneck CPU

---

## 11. Conclusione

**Sonic Sphere** è un'esperienza audio-contemplativa unica che combina:
- Sintesi sonora generativa in tempo reale
- Esplorazione spaziale libera
- Evoluzione lenta e organica
- Pura immersione sensoriale

L'idea è **validata** e **pronta per prototipazione tecnica**.

Il focus è su **qualità sonora** e **immersione contemplativa**, non su gameplay ludico.

Prossimo step: Iniziare lo sviluppo in Claude Code con Web Audio API.

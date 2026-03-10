# Sonic Sphere - Documentazione Tecnica (Aggiornata)

**Ultimo aggiornamento:** 10 marzo 2026  
**Stato:** Prototipo avanzato, playable, in tuning continuo  
**Target:** browser desktop (WebGL + Web Audio)

---

## 1. Visione

**Sonic Sphere** è un'esperienza di esplorazione sonora contemplativa su una superficie sferica.  
Il giocatore non ha obiettivi ludici: esplora, ascolta, attraversa regioni con identità timbriche diverse e transizioni meteo che trasformano il mix globale.

---

## 2. Stack Tecnologico

| Componente | Tecnologia | Note |
|---|---|---|
| Runtime | TypeScript + Vite | loop real-time, orchestrazione sistemi |
| Audio | Tone.js / Web Audio API | sintesi multi-engine + catena FX meteo |
| Spatial Audio | Tone.Panner3D | posizionamento 3D delle sorgenti |
| Rendering | Pixi.js (WebGL) | visual astratto ad alte prestazioni |
| Persistenza | localStorage | posizione, heading, world epoch |

Script principali:
- `npm run dev`
- `npm run build`
- `npm run preview`

---

## 3. Stato Attuale del Prodotto

### 3.1 Esperienza Utente

- Overlay iniziale/pausa artistico con click-to-enter.
- Nessun HUD di debug/performance a schermo.
- Persistenza stato tra sessioni.
- Autopilot organico attivo (toggle manuale disponibile).

### 3.2 Controlli

- `WASD` / frecce: movimento
- `P` o `TAB`: toggle autopilot
- `ESC`: pausa/ripresa
- Click overlay: avvio/ripresa audio

---

## 4. Modello del Mondo

### 4.1 Geometria e movimento

- Raggio sfera: `SPHERE_RADIUS = 200`
- Raggio udibile: `HEARING_RADIUS = 52`
- Movimento su geodetica con heading locale.
- Clamp anti-singolarità poli (`±89.5°`).

### 4.2 Sorgenti

- Le sorgenti oscillano lentamente attorno a una posizione di equilibrio.
- Distribuzione spaziale pseudo-uniforme (Fibonacci-like con jitter).
- PRNG deterministico per world layout ripetibile.
- Detune univoco per clone archetipico per ridurre duplicazioni tonali percepite.

### 4.3 Cardinalità e densità

La densità è guidata da `PERFORMANCE_BUDGET.world.densityMultiplier`:
- `BASE_SOURCE_COUNT = max(180, round(240 * density))`
- `RHYTHMIC_EXTRA_SOURCE_COUNT = max(120, round(180 * density))`
- `SOURCE_COUNT = BASE + RHYTHMIC_EXTRA`

Valori tipici per tier:
- `high`: ~1260 sorgenti
- `balanced`: ~945 sorgenti
- `low`: ~672 sorgenti

---

## 5. Engine Sonori e Archetipi

### 5.1 Famiglie engine

Ogni archetype usa uno dei seguenti engine:
- `subtractive` (default): osc + sub + air oscillator opzionale
- `noise`: sorgente noise colorata
- `fm`: `Tone.FMOscillator`
- `resonator`: noise excitation + feedback comb filter

### 5.2 Libreria archetipi

- Archetipi totali: **132**
- Archetipi con `mode: 'rhythmic'`: **66**
- Engine espliciti:
  - `noise`: 8
  - `fm`: 4
  - `resonator`: 4
  - restanti in `subtractive` (default)

### 5.3 Distribuzione equilibrata per engine

In `SphereWorld` la generazione usa pesi per evitare sbilanciamenti forti:
- Base pool: `subtractive 0.55`, `noise 0.15`, `fm 0.15`, `resonator 0.15`
- Rhythmic extra pool: `subtractive 0.5`, `noise 0.15`, `fm 0.175`, `resonator 0.175`

---

## 6. Meteo Sonoro (Weather Zones)

### 6.1 Modello zone

- Zone generate: `DEFAULT_ZONE_COUNT = 28`
- Zone attive simultanee: max `3`
- Zone forti simultanee: max `2` (+1 background)
- Tipi: `mist`, `echo`, `ion`
- Influenza calcolata con core + feather + smoothstep
- Drift lento su lat/lon (world vivo nel tempo)

Questo rispetta la direzione estetica discussa: **max 2 forti + 1 di sfondo**.

### 6.2 Catena FX globale

Il meteo modifica la catena FX globale:
- pre-FX `highpass` + `lowpass`
- ramo `bandpass` con sweep rapido (LFO)
- `FeedbackDelay`
- `JCReverb`
- crossfade dry/wet con attenuazione dry controllata
- limiter finale

### 6.3 Delay organico e quantizzato

- Delay organico per zona (oscillazione lenta parametrica).
- Stabilizzazione con quantizzazione step e hold time.
- Transizioni più percettibili ma controllate (riduzione zipper/click).

### 6.4 Profili meteo pronti

Sono disponibili 3 preset completi:
- `subtle`
- `experimental`
- `extreme`

Selettore attivo:
- `ACTIVE_WEATHER_FX_PROFILE` in `src/engine/WeatherZoneEngine.ts`

**Default corrente:** `experimental`.

Ogni preset modifica:
- peso zone e ruoli
- bias FX per tipo meteo
- boost in overlap (2-3 zone)
- moltiplicatori finali FX
- quantizzazione delay
- smoothing temporale
- risposta/limiti runtime audio (allineati in `AudioEngine`)

---

## 7. Visual System

### 7.1 Layering

Ordine layer (bottom -> top):
- background
- zone world/sonic
- weather zones
- trail player
- graticola
- horizon world
- glyph sorgenti
- ring overlay
- compass
- player dot

### 7.2 Zone meteo visive

- Colori meteo separati dalla palette audible-zone.
- Palette distinta per tipo (`mist/echo/ion`).
- Trasparenze elevate.
- Overlap con blending additivo (`blendMode = 'add'`) per somma cromatica piacevole.

### 7.3 Glyph per engine sonoro

Mappatura forma -> engine:
- `subtractive`: cerchio
- `noise`: triangolo
- `fm`: quadrato
- `resonator`: esagono

Le forme sono usate su glow/body/core/ring (non solo sul nucleo).
In più ogni engine ha un proprio profilo animazione (breath/ring/pulse) per riconoscibilità immediata.

---

## 8. Performance e Anti-Glitch

### 8.1 Tier automatici

`PerformanceBudget` seleziona `high | balanced | low` usando:
- `hardwareConcurrency`
- `deviceMemory`
- user-agent (Windows più conservativo)

Override disponibili:
- query param `?perfTier=high|balanced|low`
- `localStorage` key `sonicsphere.perfTier`

### 8.2 Budget per tier

Parametri principali per tier:
- `targetMaxActiveSources`
- `minMaxActiveSources`
- `maxNewStartsPerFrame`
- loop rates (`worldHz`, `weatherHz`, `renderHz`)
- qualità renderer (`pixelRatioCap`, `antialias`)
- opzioni synth (air osc, timbre LFO, panning model)

### 8.3 Mitigazioni click/glitch

Misure attive:
- quota voci adattiva con hysteresis di rilascio (`ACTIVE_RELEASE_MARGIN`)
- limite avvii per frame (`maxNewStartsPerFrame`)
- smoothing su gain/position sorgenti
- guard audio su applicazione blend meteo:
  - minimo intervallo update
  - soglie delta minime
  - slew-rate limit sweep range
- ramp time differenziati per parametri critici (delay/reverb/LFO)
- limiter in uscita master

### 8.4 HUD / debug overlay

- HUD performance rimosso completamente.
- Overlay debug meteo rimosso.
- Lo stato performance resta tracciabile via log console e parametri budget.

---

## 9. Loop Runtime

Il loop principale è a step separati:
- update mondo
- update meteo
- update rendering

Ogni step usa accumulator e frequenze target da `PerformanceBudget`.  
Persistenza player ogni 5 secondi + eventi `visibilitychange/pagehide/beforeunload`.

---

## 10. Persistenza

Storage key: `sonicsphere-v1`

Dati salvati:
- `playerPosition`
- `playerHeading`
- `worldEpochMs`
- `lastSeenAtMs`

Il `worldEpochMs` mantiene coerente l'evoluzione oscillatoria tra sessioni.

---

## 11. Mappa File (punti di tuning principali)

- `src/engine/WeatherZoneEngine.ts`
  - preset meteo (`subtle/experimental/extreme`)
  - blending zone, overlap boost, quantizzazione delay, smoothing
- `src/engine/AudioEngine.ts`
  - profili audio allineati ai preset meteo
  - limiti, ramp, guard anti-glitch
- `src/engine/SphereWorld.ts`
  - densità sorgenti, distribuzione engine, voice cap adattivo
- `src/audio/SourceSynth.ts`
  - implementazione engine timbrici
- `src/render/WorldView.ts`
  - palette meteo additive
  - mappatura forme per engine
  - profili animazione glyph per engine
- `src/engine/sphereMath.ts`
  - `SPHERE_RADIUS`, `HEARING_RADIUS`
- `src/engine/PerformanceBudget.ts`
  - auto-tier e budget per hardware

---

## 12. Changelog Tecnico Recente (Sintesi)

- Aggiunte weather zones che processano il mix globale.
- Potenziati delay/reverb/band-pass sweep con carattere più experimental.
- Delay time stabilizzato con quantizzazione + hold nelle transizioni meteo.
- Distinzione cromatica zone meteo con blending additivo in overlap.
- Risolte/mitigate cause di click con smoothing, guard e voice management.
- Rimosso completamente HUD performance e relativo codice runtime.
- Aggiunta codifica visiva per engine sonoro con forme dedicate.
- Aggiunto profilo animazione per-engine (ring/pulse/breath).
- Ridotto raggio sfera-mondo da 250 a 200.
- Introdotti preset meteo `subtle / experimental / extreme` con switch rapido.

---

## 13. Stato Decisioni

- Visione estetica attuale: contemplativa con zone meteo più espressive.
- Profilo attivo per test: `experimental`.
- Direzione compatibilità: priorità stabilità audio su macchine meno performanti.

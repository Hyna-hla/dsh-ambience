window.__ModuleLoader__.load({
  id: "dsh-ambience",
  factory: function (require) {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require("react");
    var h = react.createElement;
    var useState = react.useState;
    var useEffect = react.useEffect;
    var useRef = react.useRef;

    var LS_KEY = "dsh-ambience:v1";
    var IMG_PERSIST_MAX = 2.5 * 1024 * 1024;
    var AUDIO_PERSIST_MAX = 4 * 1024 * 1024;

    var EQ_BANDS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
    var EQ_PRESETS = {
      "平直": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      "流行": [-1.5, 1.5, 3, 4, 2, 0, -1, -1, 0.5, 1],
      "摇滚": [4, 3, 2, 0, -1, -0.5, 1.5, 3, 4, 4.5],
      "古典": [3, 2, 1, 0, 0, -0.5, 1, 2, 3, 3.5],
      "电子": [4.5, 4, 1.5, -1, -2, -0.5, 2, 3, 4, 4],
      "人声": [-2, -1, 0, 1.5, 3.5, 4, 3, 1.5, 0.5, -0.5]
    };

    function defaults() {
      return {
        bg: { on: false, image: null, opacity: 0.55, blur: 0, autoFade: false },
        music: { volume: 80, eqOn: true, preamp: 0, preset: "平直", gains: EQ_PRESETS["平直"].slice(), shuffle: false, repeat: "off" },
        tracks: []
      };
    }
    function loadSettings() {
      try {
        var raw = JSON.parse(localStorage.getItem(LS_KEY) || "null");
        if (!raw || typeof raw !== "object") return defaults();
        var d = defaults();
        if (raw.bg && typeof raw.bg === "object") {
          d.bg.on = !!raw.bg.on;
          d.bg.image = typeof raw.bg.image === "string" ? raw.bg.image : null;
          d.bg.opacity = typeof raw.bg.opacity === "number" ? raw.bg.opacity : d.bg.opacity;
          d.bg.blur = typeof raw.bg.blur === "number" ? raw.bg.blur : d.bg.blur;
          d.bg.autoFade = !!raw.bg.autoFade;
        }
        if (raw.music && typeof raw.music === "object") {
          d.music.volume = typeof raw.music.volume === "number" ? raw.music.volume : d.music.volume;
          d.music.eqOn = raw.music.eqOn !== false;
          d.music.preamp = typeof raw.music.preamp === "number" ? raw.music.preamp : 0;
          d.music.preset = EQ_PRESETS[raw.music.preset] ? raw.music.preset : "平直";
          d.music.gains = Array.isArray(raw.music.gains) && raw.music.gains.length === 10 ? raw.music.gains : d.music.gains;
          d.music.shuffle = !!raw.music.shuffle;
          d.music.repeat = raw.music.repeat === "all" || raw.music.repeat === "one" ? raw.music.repeat : "off";
        }
        if (Array.isArray(raw.tracks)) {
          d.tracks = raw.tracks.filter(function (t) { return t && typeof t.name === "string" && typeof t.url === "string" && t.url.indexOf("data:") === 0; });
        }
        return d;
      } catch (e) { return defaults(); }
    }
    function saveSettings(s) {
      try {
        var copy = JSON.parse(JSON.stringify(s));
        if (!copy.bg || !copy.bg.image || copy.bg.image.length > IMG_PERSIST_MAX) {
          if (copy.bg) copy.bg.image = null;
        }
        copy.tracks = (copy.tracks || []).filter(function (t) { return t && t.url && t.url.indexOf("data:") === 0 && t.url.length <= AUDIO_PERSIST_MAX; });
        localStorage.setItem(LS_KEY, JSON.stringify(copy));
      } catch (e) { /* 容量满等极端情况忽略 */ }
    }

    // ==================== 音频引擎 ====================
    var audioEl = null;
    var audioCtx = null;
    var graph = null; // { preamp, filters: [], master }
    function ensureAudioEl() {
      if (!audioEl) {
        audioEl = new Audio();
        audioEl.preload = "auto";
      }
      return audioEl;
    }
    function ensureGraph() {
      ensureAudioEl();
      if (!audioCtx) {
        try {
          var AC = window.AudioContext || window.webkitAudioContext;
          audioCtx = new AC();
          var src = audioCtx.createMediaElementSource(audioEl);
          var preamp = audioCtx.createGain();
          var master = audioCtx.createGain();
          var filters = [];
          for (var i = 0; i < EQ_BANDS.length; i++) {
            var f = audioCtx.createBiquadFilter();
            f.type = "peaking";
            f.frequency.value = EQ_BANDS[i];
            f.Q.value = 1.1;
            f.gain.value = 0;
            filters.push(f);
          }
          src.connect(preamp);
          var node = preamp;
          for (var j = 0; j < filters.length; j++) { node.connect(filters[j]); node = filters[j]; }
          node.connect(master);
          master.connect(audioCtx.destination);
          graph = { preamp: preamp, filters: filters, master: master };
          applyAudioSettings();
        } catch (e) { audioCtx = null; graph = null; }
      }
      return graph;
    }
    function dbToLin(db) { return Math.pow(10, (db || 0) / 20); }
    function applyAudioSettings() {
      if (!graph) return;
      var m = runtime.settings ? runtime.settings.music : null;
      if (!m) return;
      graph.master.gain.value = Math.min(Math.max((m.volume || 100) / 100, 0), 2);
      graph.preamp.gain.value = m.eqOn ? dbToLin(m.preamp) : 1;
      var gains = m.gains || [];
      for (var i = 0; i < graph.filters.length; i++) {
        graph.filters[i].gain.value = m.eqOn ? (gains[i] || 0) : 0;
      }
    }

    // ==================== 运行时状态 ====================
    var runtime = {
      settings: null,
      sessionTracks: [], // 大文件（blob URL，会话级）
      currentIdx: -1,
      playing: false,
      listeners: []
    };
    function notify() {
      runtime.listeners.forEach(function (fn) { try { fn(); } catch (e) { /* ignore */ } });
    }
    function allTracks() {
      var persisted = (runtime.settings && runtime.settings.tracks) || [];
      return persisted.concat(runtime.sessionTracks);
    }
    function playTrack(i) {
      var tracks = allTracks();
      if (i < 0 || i >= tracks.length) return;
      runtime.currentIdx = i;
      ensureGraph();
      if (audioCtx && audioCtx.state === "suspended") { try { audioCtx.resume(); } catch (e) {} }
      try {
        audioEl.src = tracks[i].url;
        audioEl.play().then(function () {
          runtime.playing = true;
          updateMediaSession();
          notify();
        }).catch(function () { runtime.playing = false; notify(); });
      } catch (e) { runtime.playing = false; notify(); }
    }
    function togglePlay() {
      if (runtime.playing) {
        audioEl.pause();
        runtime.playing = false;
        notify();
      } else {
        if (runtime.currentIdx < 0 && allTracks().length) { playTrack(0); return; }
        if (runtime.currentIdx < 0) return;
        playTrack(runtime.currentIdx);
      }
    }
    function nextTrack() {
      var tracks = allTracks();
      if (!tracks.length) return;
      var m = runtime.settings && runtime.settings.music;
      var repeat = m && m.repeat;
      if (repeat === "one" && runtime.currentIdx >= 0) { playTrack(runtime.currentIdx); return; }
      var idx;
      if (m && m.shuffle && tracks.length > 1) {
        do { idx = Math.floor(Math.random() * tracks.length); } while (idx === runtime.currentIdx);
      } else {
        idx = runtime.currentIdx + 1;
        if (idx >= tracks.length) {
          if (repeat === "all") idx = 0; else return; // 列表播完且不循环：停止
        }
      }
      playTrack(idx);
    }
    function prevTrack() {
      var tracks = allTracks();
      if (!tracks.length) return;
      var idx = runtime.currentIdx <= 0 ? tracks.length - 1 : runtime.currentIdx - 1;
      playTrack(idx);
    }
    function updateMediaSession() {
      try {
        if (!navigator.mediaSession) return;
        var tracks = allTracks();
        var cur = tracks[runtime.currentIdx];
        navigator.mediaSession.metadata = new MediaMetadata({
          title: cur ? cur.name : "DSH Ambience",
          artist: "DSH 背景音乐"
        });
      } catch (e) { /* ignore */ }
    }
    function setupMediaSessionHandlers() {
      try {
        if (!navigator.mediaSession) return;
        try { navigator.mediaSession.setActionHandler("play", function () { togglePlay(); }); } catch (e) {}
        try { navigator.mediaSession.setActionHandler("pause", function () { togglePlay(); }); } catch (e) {}
        try { navigator.mediaSession.setActionHandler("previoustrack", function () { prevTrack(); }); } catch (e) {}
        try { navigator.mediaSession.setActionHandler("nexttrack", function () { nextTrack(); }); } catch (e) {}
      } catch (e) { /* ignore */ }
    }

    // ==================== 背景图层 ====================
    var bgA = null;
    var bgB = null;
    var activeBg = null;
    var bodyStyleEl = null;
    var tokenDisposer = null;
    var ambCtx = null;
    var styleEl = null;

    function injectStyles() {
      if (styleEl) return;
      styleEl = document.createElement("style");
      styleEl.setAttribute("data-amb", "1");
      styleEl.textContent =
        ".amb-root{position:fixed;right:14px;bottom:14px;z-index:2147483000;display:flex;flex-direction:column;align-items:flex-end;gap:8px;pointer-events:none;font-family:inherit}" +
        ".amb-pill{pointer-events:auto;display:flex;align-items:center;gap:6px;padding:6px 10px;border-radius:999px;" +
        "background:var(--dsw-alias-bg-overlay,#222);border:1px solid var(--dsw-alias-border-l1,#444);" +
        "box-shadow:0 4px 16px rgba(0,0,0,.25);color:var(--dsw-alias-label-primary,#eee);backdrop-filter:blur(10px);font-size:12px}" +
        ".amb-btn{pointer-events:auto;border:1px solid var(--dsw-alias-border-l1,#444);background:transparent;color:var(--dsw-alias-label-primary,#eee);" +
        "border-radius:6px;padding:2px 8px;font-size:12px;cursor:pointer;line-height:1.6}" +
        ".amb-btn:hover{border-color:var(--dsw-alias-brand-primary,#4d7cfe)}" +
        ".amb-panel{pointer-events:auto;width:330px;max-height:72vh;overflow:auto;border-radius:12px;" +
        "background:var(--dsw-alias-bg-overlay,#1d1d1f);border:1px solid var(--dsw-alias-border-l1,#444);" +
        "box-shadow:0 8px 32px rgba(0,0,0,.35);color:var(--dsw-alias-label-primary,#eee);backdrop-filter:blur(14px);font-size:12px}" +
        ".amb-tabs{display:flex;gap:4px;padding:8px 8px 0}" +
        ".amb-tab{padding:4px 10px;border-radius:6px;cursor:pointer;border:1px solid transparent;color:var(--dsw-alias-label-secondary,#bbb)}" +
        ".amb-tab.active{border-color:var(--dsw-alias-border-l2,#555);background:var(--dsw-alias-bg-layer-1,#2a2a2c);color:var(--dsw-alias-label-primary,#eee)}" +
        ".amb-body{padding:4px 12px 12px}" +
        ".amb-row{display:flex;align-items:center;gap:6px;margin:6px 0}" +
        ".amb-track{display:flex;justify-content:space-between;gap:6px;padding:4px 6px;border-radius:6px;cursor:pointer}" +
        ".amb-track:hover{background:var(--dsw-alias-bg-layer-1,#2a2a2c)}" +
        ".amb-track.playing{color:var(--dsw-alias-brand-primary,#4d7cfe)}" +
        ".amb-title{font-size:11px;color:var(--dsw-alias-label-secondary,#999);margin:2px 0}" +
        ".amb-track-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:220px}" +
        "input[type=range].amb-range{flex:1;accent-color:var(--dsw-alias-brand-primary,#4d7cfe)}" +
        "@keyframes amb-breathe{0%{opacity:var(--amb-lo,.4)}100%{opacity:var(--amb-hi,.8)}}";
      document.head.appendChild(styleEl);
    }
    function ensureBgLayers() {
      if (bgA) return;
      bgA = document.createElement("div");
      bgB = document.createElement("div");
      bgA.setAttribute("data-amb-bg", "a");
      bgB.setAttribute("data-amb-bg", "b");
      var base = "position:fixed;inset:0;z-index:-1;pointer-events:none;background-size:cover;background-position:center;transition:opacity 1.4s ease;";
      bgA.style.cssText = base + "opacity:0";
      bgB.style.cssText = base + "opacity:0";
      document.body.appendChild(bgA);
      document.body.appendChild(bgB);
      bodyStyleEl = document.createElement("style");
      bodyStyleEl.setAttribute("data-amb-body", "1");
      bodyStyleEl.textContent = "";
      document.head.appendChild(bodyStyleEl);
    }
    function removeBgLayers() {
      if (bgA && bgA.parentNode) bgA.parentNode.removeChild(bgA);
      if (bgB && bgB.parentNode) bgB.parentNode.removeChild(bgB);
      if (bodyStyleEl && bodyStyleEl.parentNode) bodyStyleEl.parentNode.removeChild(bodyStyleEl);
      if (styleEl && styleEl.parentNode) styleEl.parentNode.removeChild(styleEl);
      bgA = bgB = activeBg = null;
      bodyStyleEl = null;
      styleEl = null;
    }
    function buildTokenOverrides() {
      var tokens = [
        { name: "--dsw-alias-bg-base", alpha: 0.72 },
        { name: "--dsw-alias-bg-layer-1", alpha: 0.78 },
        { name: "--dsw-alias-bg-layer-2", alpha: 0.84 },
        { name: "--dsw-specific-sidebar-fill", alpha: 0.8 }
      ];
      var map = {};
      try {
        var cs = getComputedStyle(document.documentElement);
        for (var i = 0; i < tokens.length; i++) {
          var cur = (cs.getPropertyValue(tokens[i].name) || "").trim();
          if (!cur) continue;
          var mixed = "color-mix(in srgb, " + cur + " " + Math.round(tokens[i].alpha * 100) + "%, transparent)";
          map[tokens[i].name] = { light: mixed, dark: mixed };
        }
      } catch (e) { /* ignore */ }
      return map;
    }
    function reapplyTokens(enable) {
      if (tokenDisposer) { try { tokenDisposer(); } catch (e) {} tokenDisposer = null; }
      if (!enable || !ambCtx || !ambCtx.theme || typeof ambCtx.theme.overrideTokens !== "function") return;
      var map = buildTokenOverrides();
      if (!Object.keys(map).length) return;
      try { tokenDisposer = ambCtx.theme.overrideTokens("dsh-ambience", map); } catch (e) { tokenDisposer = null; }
    }
    function renderBg() {
      var s = runtime.settings;
      if (!s) return;
      ensureBgLayers();
      var on = !!(s.bg && s.bg.on && s.bg.image);
      if (bodyStyleEl) bodyStyleEl.textContent = on ? "html,body{background:transparent !important}" : "";
      if (on) {
        var target = activeBg === bgA ? bgB : bgA;
        target.style.backgroundImage = 'url("' + s.bg.image + '")';
        target.style.filter = "blur(" + (s.bg.blur || 0) + "px)";
        if (s.bg.autoFade) {
          target.style.setProperty("--amb-lo", String(Math.max(0.05, (s.bg.opacity || 0.5) * 0.55)));
          target.style.setProperty("--amb-hi", String(s.bg.opacity || 0.5));
          target.style.animation = "amb-breathe 22s ease-in-out infinite alternate";
          target.style.opacity = "1";
        } else {
          target.style.animation = "none";
          target.style.opacity = String(s.bg.opacity || 0.5);
        }
        if (activeBg && activeBg !== target) activeBg.style.opacity = "0";
        activeBg = target;
        reapplyTokens(true);
      } else {
        if (activeBg) activeBg.style.opacity = "0";
        activeBg = null;
        reapplyTokens(false);
      }
    }

    // ==================== UI 组件 ====================
    function Slider(props) {
      return h("label", { style: { display: "block", margin: "8px 0" } },
        h("span", { style: { fontSize: 11, color: "var(--dsw-alias-label-secondary,#999)" } },
          props.label + ": " + props.value + (props.suffix || "")),
        h("input", {
          type: "range", className: "amb-range", min: props.min, max: props.max, step: props.step || 1,
          value: props.value, style: { width: "100%" },
          onChange: function (ev) { props.onChange(Number(ev.target.value)); }
        })
      );
    }
    function Btn(props) {
      return h("button", { className: "amb-btn", onClick: props.onClick, title: props.title || "", style: props.style || {} }, props.label);
    }
    function Select(props) {
      return h("select", {
        className: "amb-btn", value: props.value,
        onChange: function (ev) { props.onChange(ev.target.value); }
      }, props.options.map(function (o) {
        return h("option", { value: o.value, key: o.value }, o.label);
      }));
    }

    function BgTab(props) {
      var s = props.settings;
      var b = s.bg;
      function set(k, v) { props.patchBg(k, v); }
      return h("div", null,
        h("div", { className: "amb-row" },
          h("label", { className: "amb-btn", style: { display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" } },
            h("input", { type: "checkbox", checked: b.on, onChange: function (ev) { set("on", ev.target.checked); } }),
            " 启用背景"),
          h("span", { style: { flex: 1 } }),
          Btn({ label: "📁 导入图片", onClick: function () { props.openImgPicker(); } })
        ),
        b.image ? Btn({ label: "✕ 移除图片", onClick: function () { set("image", null); } }) : null,
        h("div", { className: "amb-title" }, "支持 JPG / PNG / WebP；≤2.5MB 的图片会持久保存，重启后仍在"),
        Slider({ label: "图片透明度", value: Math.round(b.opacity * 100), min: 5, max: 100, suffix: "%", onChange: function (v) { set("opacity", v / 100); } }),
        Slider({ label: "模糊", value: b.blur, min: 0, max: 30, suffix: "px", onChange: function (v) { set("blur", v); } }),
        h("div", { className: "amb-row" },
          h("label", { style: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 } },
            h("input", { type: "checkbox", checked: b.autoFade, onChange: function (ev) { set("autoFade", ev.target.checked); } }),
            " 自主呼吸淡化（缓慢明暗循环）")),
        h("div", { className: "amb-title" }, "背景开启时应用表面会自动半透明，文字保持可读；换图带 1.4s 交叉淡化")
      );
    }

    function MusicTab(props) {
      var s = props.settings;
      var m = s.music;
      var tracks = allTracks();
      function set(k, v) { props.patchMusic(k, v); }
      return h("div", null,
        h("div", { className: "amb-row" },
          Btn({ label: "⏮", title: "上一曲", onClick: function () { prevTrack(); } }),
          Btn({ label: runtime.playing ? "⏸" : "▶", title: "播放/暂停", onClick: function () { togglePlay(); } }),
          Btn({ label: "⏭", title: "下一曲", onClick: function () { nextTrack(); } }),
          h("span", { style: { flex: 1 } }),
          Btn({ label: "📁 导入音乐", onClick: function () { props.openAudioPicker(); } })
        ),
        h("div", { className: "amb-row" },
          h("span", { style: { fontSize: 11, color: "var(--dsw-alias-label-secondary,#999)" } }, "循环"),
          Select({ value: m.repeat, onChange: function (v) { set("repeat", v); }, options: [
            { value: "off", label: "关闭" }, { value: "all", label: "列表循环" }, { value: "one", label: "单曲循环" }
          ] }),
          h("label", { style: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 11 } },
            h("input", { type: "checkbox", checked: m.shuffle, onChange: function (ev) { set("shuffle", ev.target.checked); } }),
            "随机")
        ),
        Slider({ label: "音量", value: m.volume, min: 0, max: 200, suffix: "%", onChange: function (v) { set("volume", v); } }),
        h("div", { className: "amb-title" }, "播放列表（点击播放；大文件仅本会话有效）：" + tracks.length + " 首"),
        tracks.length === 0
          ? h("div", { className: "amb-title" }, "尚未导入音乐。支持 FLAC / MP3 / WAV / M4A / OGG")
          : tracks.map(function (t, i) {
            return h("div", {
              className: "amb-track" + (i === runtime.currentIdx ? " playing" : ""), key: i,
              onClick: function () { playTrack(i); }
            },
              h("span", { className: "amb-track-name" }, t.name),
              Btn({ label: "✕", title: "移除", onClick: function (ev) { ev.stopPropagation(); props.removeTrack(i); } }));
          })
      );
    }

    function EqTab(props) {
      var s = props.settings;
      var m = s.music;
      function set(k, v) { props.patchMusic(k, v); }
      return h("div", null,
        h("div", { className: "amb-row" },
          h("label", { style: { display: "inline-flex", alignItems: "center", gap: 4, fontSize: 12 } },
            h("input", { type: "checkbox", checked: m.eqOn, onChange: function (ev) { set("eqOn", ev.target.checked); } }),
            " 均衡器启用（取消勾选=旁路）"),
          h("span", { style: { flex: 1 } }),
          Select({ value: m.preset, onChange: function (v) { props.applyPreset(v); }, options: Object.keys(EQ_PRESETS).map(function (k) { return { value: k, label: k }; }) })
        ),
        Slider({ label: "预放大", value: m.preamp, min: -12, max: 12, step: 0.5, suffix: "dB", onChange: function (v) { set("preamp", v); } }),
        EQ_BANDS.map(function (freq, i) {
          return h("div", { key: freq, style: { display: "flex", alignItems: "center", gap: 6, margin: "4px 0" } },
            h("span", { style: { width: 44, fontSize: 11, color: "var(--dsw-alias-label-secondary,#999)", textAlign: "right" } }, freq >= 1000 ? (freq / 1000) + "k" : String(freq)),
            h("input", {
              type: "range", className: "amb-range", min: -12, max: 12, step: 0.5, value: m.gains[i] || 0, style: { flex: 1 },
              onChange: (function (idx) {
                return function (ev) {
                  var g = m.gains.slice();
                  g[idx] = Number(ev.target.value);
                  props.patchMusic("gains", g);
                };
              })(i)
            }),
            h("span", { style: { width: 34, fontSize: 11, color: "var(--dsw-alias-label-secondary,#999)" } }, (m.gains[i] > 0 ? "+" : "") + (m.gains[i] || 0))
          );
        })
      );
    }

    function App() {
      var [settings, setSettings] = useState(null);
      var [open, setOpen] = useState(false);
      var [tab, setTab] = useState("music");
      var [playing, setPlaying] = useState(false);
      var [, force] = useState(0);
      var audioInputRef = useRef(null);
      var imgInputRef = useRef(null);

      useEffect(function () {
        var s = loadSettings();
        runtime.settings = s;
        setSettings(s);
        ensureAudioEl();
        ensureBgLayers();
        setupMediaSessionHandlers();
        var onPlay = function () { runtime.playing = true; setPlaying(true); };
        var onPause = function () { runtime.playing = false; setPlaying(false); };
        var onEnded = function () { nextTrack(); };
        audioEl.addEventListener("play", onPlay);
        audioEl.addEventListener("pause", onPause);
        audioEl.addEventListener("ended", onEnded);
        var unsub = function () { runtime.listeners = runtime.listeners.filter(function (f) { return f !== unsub; }); };
        runtime.listeners.push(function () { force(function (x) { return x + 1; }); });
        renderBg();
        return function () {
          audioEl.removeEventListener("play", onPlay);
          audioEl.removeEventListener("pause", onPause);
          audioEl.removeEventListener("ended", onEnded);
          unsub();
        };
      }, []);

      useEffect(function () {
        if (!settings) return;
        runtime.settings = settings;
        saveSettings(settings);
        applyAudioSettings();
        renderBg();
        updateMediaSession();
      }, [settings]);

      function patchBg(k, v) {
        setSettings(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          next.bg[k] = v;
          return next;
        });
      }
      function patchMusic(k, v) {
        setSettings(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          next.music[k] = v;
          return next;
        });
      }
      function applyPreset(name) {
        var g = EQ_PRESETS[name] || EQ_PRESETS["平直"];
        setSettings(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          next.music.preset = name;
          next.music.gains = g.slice();
          return next;
        });
      }
      function removeTrack(i) {
        var persistedCount = settings.tracks.length;
        if (i < persistedCount) {
          setSettings(function (prev) {
            var next = JSON.parse(JSON.stringify(prev));
            next.tracks = next.tracks.filter(function (x, idx) { return idx !== i; });
            return next;
          });
        } else {
          var si = i - persistedCount;
          var t = runtime.sessionTracks[si];
          if (t && t.url && t.url.indexOf("blob:") === 0) { try { URL.revokeObjectURL(t.url); } catch (e) {} }
          runtime.sessionTracks = runtime.sessionTracks.filter(function (x, idx) { return idx !== si; });
          notify();
        }
        if (runtime.currentIdx === i) {
          try { audioEl.pause(); } catch (e) {}
          runtime.currentIdx = -1;
          runtime.playing = false;
          notify();
        }
      }
      function onAudioFiles(ev) {
        var files = Array.prototype.slice.call(ev.target.files || []);
        ev.target.value = "";
        files.forEach(function (file) {
          var reader = new FileReader();
          reader.onload = function () {
            var dataUrl = String(reader.result);
            setSettings(function (prev) {
              var next = JSON.parse(JSON.stringify(prev));
              if (dataUrl.length <= AUDIO_PERSIST_MAX) {
                next.tracks = next.tracks.concat([{ name: file.name, url: dataUrl }]);
              } else {
                var url = URL.createObjectURL(file);
                runtime.sessionTracks.push({ name: file.name, url: url });
              }
              return next;
            });
          };
          reader.readAsDataURL(file);
        });
      }
      function onImgFile(ev) {
        var file = ev.target.files && ev.target.files[0];
        ev.target.value = "";
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          var dataUrl = String(reader.result);
          setSettings(function (prev) {
            var next = JSON.parse(JSON.stringify(prev));
            next.bg.image = dataUrl;
            next.bg.on = true;
            return next;
          });
        };
        reader.readAsDataURL(file);
      }

      if (!settings) return h("div", { className: "amb-root" });

      return h("div", { className: "amb-root" },
        h("input", { type: "file", ref: audioInputRef, style: { display: "none" }, multiple: true,
          accept: ".flac,.mp3,.wav,.m4a,.ogg,audio/flac,audio/mpeg,audio/wav,audio/x-flac,audio/ogg", onChange: onAudioFiles }),
        h("input", { type: "file", ref: imgInputRef, style: { display: "none" },
          accept: "image/png,image/jpeg,image/webp", onChange: onImgFile }),
        open ? h("div", { className: "amb-panel" },
          h("div", { className: "amb-tabs" },
            ["music", "bg", "eq"].map(function (t) {
              var label = t === "music" ? "🎵 音乐" : (t === "bg" ? "🖼 背景" : "🎚 调音台");
              return h("div", {
                className: "amb-tab" + (tab === t ? " active" : ""), key: t,
                onClick: function () { setTab(t); }
              }, label);
            }),
            h("span", { style: { flex: 1 } }),
            h("div", { className: "amb-tab", onClick: function () { setOpen(false); } }, "✕")
          ),
          h("div", { className: "amb-body" },
            tab === "music" ? h(MusicTab, {
              settings: settings, patchMusic: patchMusic, removeTrack: removeTrack,
              openAudioPicker: function () { if (audioInputRef.current) audioInputRef.current.click(); }
            }) : null,
            tab === "bg" ? h(BgTab, {
              settings: settings, patchBg: patchBg,
              openImgPicker: function () { if (imgInputRef.current) imgInputRef.current.click(); }
            }) : null,
            tab === "eq" ? h(EqTab, { settings: settings, patchMusic: patchMusic, applyPreset: applyPreset }) : null
          )
        ) : null,
        h("div", { className: "amb-pill" },
          h("button", { className: "amb-btn", title: "上一曲", onClick: function () { prevTrack(); } }, "⏮"),
          h("button", { className: "amb-btn", title: "播放/暂停", onClick: function () { togglePlay(); } }, playing ? "⏸" : "▶"),
          h("button", { className: "amb-btn", title: "下一曲", onClick: function () { nextTrack(); } }, "⏭"),
          h("span", { style: { fontSize: 11, maxWidth: 120, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
            (function () {
              var t = allTracks()[runtime.currentIdx];
              return t ? t.name : "Ambience";
            })()),
          h("button", { className: "amb-btn", title: "展开面板", onClick: function () { setOpen(!open); } }, "🎛")
        )
      );
    }

    // ==================== 设置页入口（独立小组件） ====================
    function SettingsSection() {
      var [settings, setSettings] = useState(null);
      useEffect(function () {
        var s = loadSettings();
        runtime.settings = s;
        setSettings(s);
        ensureBgLayers();
        var unsub = function () { runtime.listeners = runtime.listeners.filter(function (f) { return f !== unsub; }); };
        runtime.listeners.push(function () { setSettings(JSON.parse(JSON.stringify(runtime.settings))); });
        return unsub;
      }, []);
      useEffect(function () {
        if (!settings) return;
        runtime.settings = settings;
        saveSettings(settings);
        applyAudioSettings();
        renderBg();
      }, [settings]);
      if (!settings) return h("section", null, "加载中…");
      var b = settings.bg;
      var m = settings.music;
      function patchBg(k, v) {
        setSettings(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          next.bg[k] = v;
          return next;
        });
      }
      function patchMusic(k, v) {
        setSettings(function (prev) {
          var next = JSON.parse(JSON.stringify(prev));
          next.music[k] = v;
          return next;
        });
      }
      function onImgFile(ev) {
        var file = ev.target.files && ev.target.files[0];
        ev.target.value = "";
        if (!file) return;
        var reader = new FileReader();
        reader.onload = function () {
          var dataUrl = String(reader.result);
          var next = function (prev) {
            var copy = JSON.parse(JSON.stringify(prev));
            if (dataUrl.length <= IMG_PERSIST_MAX) copy.bg.image = dataUrl;
            copy.bg.on = true;
            return copy;
          };
          setSettings(next);
        };
        reader.readAsDataURL(file);
      }
      return h("section", null,
        h("h2", null, "Ambience 背景与音乐"),
        h("p", null, "导入背景图后可调透明度/模糊；音乐与均衡器的完整面板在页面右下角悬浮条（🎛）。"),
        h("div", { className: "amb-row" },
          h("label", { style: { display: "inline-flex", alignItems: "center", gap: 6, cursor: "pointer" } },
            h("input", { type: "checkbox", checked: b.on, onChange: function (ev) { patchBg("on", ev.target.checked); } }),
            " 启用背景"),
          h("span", { style: { flex: 1 } }),
          h("label", { className: "amb-btn", style: { display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" } },
            h("input", { type: "file", style: { display: "none" }, accept: "image/png,image/jpeg,image/webp", onChange: onImgFile }),
            "📁 导入图片")
        ),
        b.image ? Btn({ label: "✕ 移除图片", onClick: function () { patchBg("image", null); patchBg("on", false); } }) : null,
        Slider({ label: "图片透明度", value: Math.round(b.opacity * 100), min: 5, max: 100, suffix: "%", onChange: function (v) { patchBg("opacity", v / 100); } }),
        Slider({ label: "模糊", value: b.blur, min: 0, max: 30, suffix: "px", onChange: function (v) { patchBg("blur", v); } }),
        Slider({ label: "音乐音量", value: m.volume, min: 0, max: 200, suffix: "%", onChange: function (v) { patchMusic("volume", v); } })
      );
    }

    // ==================== apply ====================
    function apply(ctx) {
      try {
        ambCtx = ctx;
        console.info("[dsh-ambience] apply 开始: slots=" + !!ctx.slots + " theme=" + !!(ctx.get && ctx.get("theme")));
        injectStyles();
        ensureBgLayers();
        ensureAudioEl();
        setupMediaSessionHandlers();

        var tokenTimer = setTimeout(function () { reapplyTokens(false); }, 300);
        if (ctx.effect) ctx.effect(function () { return function () { clearTimeout(tokenTimer); }; });

        var observer = null;
        try {
          if (typeof MutationObserver !== "undefined" && document.documentElement) {
            observer = new MutationObserver(function () {
              var on = !!(runtime.settings && runtime.settings.bg && runtime.settings.bg.on && runtime.settings.bg.image);
              reapplyTokens(on);
            });
            observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "data-theme", "data-color-scheme"] });
          }
        } catch (e) { /* ignore */ }

        if (ctx.effect) {
          ctx.effect(function () {
            return function () {
              if (observer) { try { observer.disconnect(); } catch (e) {} observer = null; }
              if (tokenDisposer) { try { tokenDisposer(); } catch (e) {} tokenDisposer = null; }
              if (audioCtx) { try { audioCtx.close(); } catch (e) {} audioCtx = null; graph = null; }
              if (audioEl) { try { audioEl.pause(); audioEl.src = ""; } catch (e) {} }
              removeBgLayers();
            };
          });
        }

        if (ctx.slots && typeof ctx.slots.inject === "function") {
          try {
            ctx.slots.inject("shell.overlay", function () {
              return ctx.slots.register(
                { name: "shell.overlay", id: "dsh-ambience", order: 100, label: "Ambience 背景与音乐" },
                function () { return h(App, null); }
              );
            });
            console.info("[dsh-ambience] shell.overlay 已注册");
          } catch (e) { console.error("[dsh-ambience] shell.overlay 注册失败", e); }

          try {
            ctx.slots.inject("settings.section", function () {
              return ctx.slots.register(
                { name: "settings.section", id: "ambience", order: 55, label: function () { return "Ambience 背景与音乐"; } },
                function () { return h(SettingsSection, null); }
              );
            });
            console.info("[dsh-ambience] settings.section 已注册");
          } catch (e) { console.error("[dsh-ambience] settings.section 注册失败", e); }
        } else {
          console.error("[dsh-ambience] ctx.slots 缺失，无法注册 UI");
        }
      } catch (e) {
        console.error("[dsh-ambience] apply 失败", e);
      }
    }

    exports.apply = apply;
    exports.inject = ["slots", "theme"];
    return module.exports;
  }
});

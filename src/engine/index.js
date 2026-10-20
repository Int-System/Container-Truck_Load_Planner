/* Container & Truck Load Planner — engine/index.js
 * Assembles the engine from its parts (geometry, constraints, cog, packer, multi) and provides a
 * Web-Worker client so heavy packing never blocks the UI.
 * Works in three environments: browser (global LPEngine), Web Worker (built from a Blob — no
 * separate worker file needed, so it also runs from file://), and Node (module.exports).
 */
(function (root) {
  'use strict';
  function buildEngine(parts) {
    var E = {};
    parts.forEach(function (p) { p(E); });
    return E;
  }

  if (typeof module !== 'undefined' && module.exports && typeof require === 'function') {
    module.exports = buildEngine([].concat(
      require('./geometry.js'), require('./constraints.js'), require('./cog.js'),
      require('./packer.js'), require('./multi.js'), require('./dunnage.js')));
    return;
  }

  var parts = root.LPEngineParts;
  var E = buildEngine(parts);

  E.workerSource = function () {
    return 'var LPEngineParts=[' + parts.map(String).join(',\n') + '];\n' +
      'var E=(' + buildEngine.toString() + ')(LPEngineParts);\n' +
      'self.onmessage=function(ev){var m=ev.data,a=m.args||[];' +
      'try{if(m.progress){var o=a[2]||(a[2]={});var last=0;o.onProgress=function(p){var t=Date.now();if(t-last>120){last=t;self.postMessage({id:m.id,progress:p});}};}' +
      'var r=E[m.cmd].apply(null,a);self.postMessage({id:m.id,ok:true,result:r});}' +
      'catch(e){self.postMessage({id:m.id,ok:false,error:String(e&&e.stack||e)});}};';
  };

  /** Promise-based client. Falls back to the main thread if Workers are unavailable. */
  E.createClient = function () {
    var worker = null, seq = 0, pending = {};
    function start() {
      try {
        var url = URL.createObjectURL(new Blob([E.workerSource()], { type: 'text/javascript' }));
        worker = new Worker(url);
        worker.onmessage = function (ev) {
          var m = ev.data, p = pending[m.id];
          if (!p) return;
          if (m.progress) { if (p.onProgress) p.onProgress(m.progress); return; }
          delete pending[m.id];
          if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error));
        };
        worker.onerror = function (e) {
          Object.keys(pending).forEach(function (id) { pending[id].reject(new Error(e.message || 'worker error')); });
          pending = {};
        };
      } catch (err) { worker = null; }
    }
    start();
    return {
      usingWorker: function () { return !!worker; },
      call: function (cmd, args, onProgress) {
        if (!worker) {
          return new Promise(function (resolve, reject) {
            setTimeout(function () {
              try { resolve(E[cmd].apply(null, args)); } catch (e) { reject(e); }
            }, 20);
          });
        }
        return new Promise(function (resolve, reject) {
          var id = ++seq;
          pending[id] = { resolve: resolve, reject: reject, onProgress: onProgress };
          worker.postMessage({ id: id, cmd: cmd, args: args, progress: !!onProgress });
        });
      },
      cancel: function () {
        if (worker) worker.terminate();
        Object.keys(pending).forEach(function (id) { pending[id].reject(new Error('cancelled')); });
        pending = {};
        start();
      }
    };
  };

  root.LPEngine = E;
})(this);

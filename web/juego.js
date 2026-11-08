/* TCPGame: interfaz del modo individual (el alumno contra el simulador). */
(function () {
  'use strict';
  const { P, ESCENARIOS, Partida, escenarioAzar } = window.MotorTCP;
  const app = document.getElementById('app');

  const NOMBRE = { A: 'Cliente A · emisor', B: 'Servidor B · receptor' };
  const CAMPOS = {
    A: [['ultimoByteEnviado', 'UltimoByteEnviado', 'último octeto que has enviado',
         'El número del último octeto de datos <b>nuevos</b> que has metido en la red. Un segmento con SN = 1152 y 64 B lleva del 1152 al 1215, así que después de enviarlo vale 1215. Una retransmisión no lo cambia, porque esos octetos ya estaban enviados. Antes de enviar nada vale 1023, el octeto anterior al primero.'],
        ['ultimoByteReconocido', 'UltimoByteReconocido', 'AN del último ACK − 1',
         'El último octeto que B te ha confirmado. El AN de un ACK es el <b>siguiente</b> octeto que B espera, así que lo confirmado llega hasta AN − 1: con AN = 1088, B tiene hasta el 1087. Un ACK duplicado no lo cambia. Antes del primer ACK vale 1023.<br>UltimoByteEnviado − UltimoByteReconocido son los octetos que tienes en vuelo: enviados y aún sin confirmar.'],
        ['ventRecepcion', 'VentRecepcion', 'W del último ACK',
         'La ventana que anunció B en el último ACK que te ha llegado, aunque sea duplicado: es el sitio que B te asegura a partir del AN. Antes del primer ACK vale 256, la W de la apertura. Puedes enviar si (UltimoByteEnviado − UltimoByteReconocido) + 64 ≤ VentRecepcion.']],
    B: [['ultimoByteRecibido', 'UltimoByteRecibido', 'último octeto recibido en orden (sin contar lo que tengas fuera de orden)',
         'El último octeto que tienes en orden, sin huecos desde el 1024. Si tienes del 1024 al 1087 y te llega del 1152 al 1215, sigue valiendo 1087: lo de después del hueco se guarda aparte. Cuando llega el segmento que rellena el hueco, salta hasta el final de lo guardado. Antes de recibir nada vale 1023. El AN de tus ACK es UltimoByteRecibido + 1.'],
        ['ultimoByteLeido', 'UltimoByteLeido', 'último octeto que ha leído tu aplicación',
         'El último octeto que tu aplicación ha sacado del búfer. Cambia solo cuando ves el aviso «Tu aplicación ha leído…». Antes de que lea nada vale 1023.<br>UltimoByteRecibido − UltimoByteLeido es lo que ocupa tu búfer: recibido y todavía sin leer.'],
        ['ventRecepcion', 'VentRecepcion', 'la W que anunciarías ahora',
         'El sitio libre que puedes ofrecer a A: VentRecepcion = 256 − (UltimoByteRecibido − UltimoByteLeido). Lo guardado fuera de orden no se descuenta. Es la W que pondrías en un ACK enviado en este tic.']],
  };
  const abiertos = new Set();   // desplegables «¿Qué es?» abiertos (sobreviven al redibujar)

  const cfg = { rol: 'A', esc: 'sorpresa', correccion: 'final', hoja: true, rapida: true, fuera: 'almacena' };
  let partida = null, escReal = null, refTic = null, fase = 'inicio', borrador = null, ultimaEval = null;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r = (ini, fin) => `${ini}–${fin}`;
  const h = (html) => { app.innerHTML = html; };

  /* ---------- Inicio ---------- */

  function inicio() {
    fase = 'inicio';
    h(`
      <header class="barra"><div class="marca"><h1>TCPGame</h1><span>Control de flujo, desde dentro de un extremo</span></div></header>
      <section class="intro">
        <h2>Juegas un extremo de una conexión TCP. El otro lo juega el ordenador.</h2>
        <p>Solo ves lo que le llega a tu lado y lo que apuntas en tu hoja, igual que TCP. No sabes qué ha enviado el otro, qué va de camino ni cuándo lee la aplicación de B. Al final se muestra el diagrama completo.</p>
      </section>
      <div class="papeles" role="group" aria-label="Papel">
        ${['A', 'B'].map((x) => `
          <button type="button" class="papel ${x}" data-rol="${x}" aria-pressed="${cfg.rol === x}">
            <strong>${NOMBRE[x]}</strong>
            <span>${x === 'A'
              ? 'Tu aplicación te ha dado 384 B (del 1024 al 1407). Decide en cada tic si cabe otro segmento en la ventana que te anuncia B.'
              : 'Recibes los segmentos de A en un búfer de 256 B. Decide cuándo enviar el ACK y qué AN y qué W anuncias.'}</span>
          </button>`).join('')}
      </div>
      <div class="opciones">
        <label>Escenario
          <select id="o-esc">
            <option value="sorpresa">Sorpresa (cualquiera de los de abajo, oculto)</option>
            <optgroup label="Control de flujo, sin pérdidas">
              ${Object.values(ESCENARIOS).filter((e) => e.grupo === 'flujo').map((e) => `<option value="${e.id}">${e.id} · ${e.nombre}</option>`).join('')}
            </optgroup>
            <optgroup label="Con pérdidas">
              ${Object.values(ESCENARIOS).filter((e) => e.grupo === 'perdidas').map((e) => `<option value="${e.id}">${e.id} · ${e.nombre}</option>`).join('')}
              <option value="AZ">AZ · Pérdidas al azar</option>
            </optgroup>
          </select>
        </label>
        <label>Lo que llega fuera de orden
          <select id="o-fuera">
            <option value="almacena">B lo guarda · A retransmite el más antiguo</option>
            <option value="descarta">B lo descarta · A retransmite toda la cola</option>
          </select>
        </label>
        <label>Corrección
          <select id="o-corr">
            <option value="final">Al final de la partida (evaluación)</option>
            <option value="tic">En cada tic (práctica)</option>
          </select>
        </label>
        <label class="check"><input type="checkbox" id="o-hoja" ${cfg.hoja ? 'checked' : ''}> Rellenar la hoja de estado en cada tic</label>
        <label class="check"><input type="checkbox" id="o-rapida" ${cfg.rapida ? 'checked' : ''}> Retransmisión rápida (3 ACK duplicados)</label>
      </div>
      <div class="acciones"><button class="btn primario" id="empezar">Empezar la partida</button></div>
      <details class="reglas panel"><summary>Reglas</summary>${reglasHTML()}</details>
    `);
    document.getElementById('o-esc').value = cfg.esc;
    document.getElementById('o-corr').value = cfg.correccion;
    document.getElementById('o-fuera').value = cfg.fuera;
    app.querySelectorAll('.papel').forEach((b) => b.addEventListener('click', () => { cfg.rol = b.dataset.rol; leerOpciones(); inicio(); }));
    document.getElementById('empezar').addEventListener('click', () => { leerOpciones(); empezar(); });
  }

  function leerOpciones() {
    const e = document.getElementById('o-esc'), c = document.getElementById('o-corr'), k = document.getElementById('o-hoja'), q = document.getElementById('o-rapida');
    if (q) cfg.rapida = q.checked;
    const fo = document.getElementById('o-fuera');
    if (fo) cfg.fuera = fo.value;
    if (e) cfg.esc = e.value;
    if (c) cfg.correccion = c.value;
    if (k) cfg.hoja = k.checked;
  }

  function reglasHTML() {
    return `
      <ul>
        <li><b>Tiempo en tics.</b> Un segmento sale al comienzo de un tic y llega a mitad de ese mismo tic. El otro lo tiene en cuenta en su decisión del tic siguiente. Por eso, lo que ves al empezar el tic <i>n</i> llegó a mitad del tic <i>n</i> − 1 y ya cuenta para lo que decidas en el tic <i>n</i>. Como mucho, un segmento por tic.</li>
        <li><b>Datos de partida.</b> MSS = 64 B. A envía del 1024 al 1407 (6 segmentos). B tiene <code>BufferRecepcion</code> = 256 B y en la apertura anunció W = 256. Los ACK de B llevan SN = 2048.</li>
        <li><b>A puede enviar</b> si <code>(UltimoByteEnviado − UltimoByteReconocido) + 64 ≤ VentRecepcion</code>, con la W del último ACK. Si no cabe, espera: en esta versión no hay segmento de sondeo.</li>
        <li><b>Variables de la hoja</b> (los nombres de Kurose). Todas son números de octeto y empiezan en 1023, el anterior al primero.
          <ul>
            ${['A', 'B'].map((x) => CAMPOS[x].map(([, n, , d]) => `<li><b>${n}</b>${x === 'A' ? ' (A)' : ' (B)'}: ${d}</li>`).join('')).join('')}
          </ul></li>
        <li><b>B calcula</b> <code>VentRecepcion = 256 − (UltimoByteRecibido − UltimoByteLeido)</code> en el tic en que envía el ACK.</li>
        <li><b>ACK retardado (CR3).</b> Si a B le llega un segmento en orden y no tenía ningún ACK pendiente, espera un tic. En el tic siguiente envía el ACK, que también reconoce el que haya llegado entretanto (CR4).</li>
        <li><b>Fuera de orden (CR5).</b> Si a B le llega un segmento fuera de orden, responde enseguida con un ACK duplicado (el AN que sigue esperando). Lo que hace con el segmento depende de la opción de la partida, como en los ejercicios:
          <ul>
            <li><b>B lo guarda.</b> Cuando llega el que rellena el hueco, responde enseguida con un ACK que reconoce todo lo que ya tiene en orden (CR6). Al vencer el temporizador, A reenvía solo el más antiguo sin reconocer.</li>
            <li><b>B lo descarta.</b> El hueco se rellena con un segmento en orden normal (CR3 y CR4). Como B ha tirado lo que venía detrás, al vencer el temporizador A reenvía el más antiguo y después el resto de la cola, uno por tic, hasta lo último que había enviado.</li>
          </ul>
          Si a B le llega algo que ya tenía, también responde enseguida.</li>
        <li><b>Lo fuera de orden no reduce la W.</b> <code>UltimoByteRecibido</code> es el último octeto recibido en orden, así que la fórmula de la W no cambia: el borde derecho de la ventana nunca retrocede.</li>
        <li><b>Actualización de ventana.</b> Si B anunció W = 0 y su aplicación libera sitio, avisa a A en ese mismo tic con un ACK (mismo AN, W nueva).</li>
        <li><b>Pérdidas.</b> En los escenarios P y AZ la red pierde algún segmento de datos o algún ACK. Nadie se entera: ni quien lo envió ni quien debía recibirlo.</li>
        <li><b>Temporizador de A.</b> Es uno solo y lo lleva el juego. Se arranca al enviar si estaba parado, se reinicia con cada ACK que reconoce algo nuevo y al retransmitir. Si vence, A reenvía el segmento más antiguo sin reconocer (SN = último AN) y, si B descarta lo que llega fuera de orden, después el resto de la cola. Reenviar la cola no reinicia el temporizador.</li>
        <li><b>Retransmisión rápida</b> (si está activada). Un ACK es duplicado si trae el mismo AN que el último y A tiene datos sin reconocer. Al llegar el <b>tercer</b> ACK duplicado, A reenvía el segmento más antiguo sin reconocer sin esperar al temporizador. La cuenta vuelve a 0 con un ACK que reconoce algo nuevo y cuando vence el temporizador. Si está desactivada, como en los ejercicios de la web, los ACK duplicados no hacen reenviar.</li>
        <li><b>Si te sales de la ventana.</b> B descarta lo que no cabe en su búfer y responde enseguida con el AN que espera.</li>
        <li><b>Puntuación</b> (menos es mejor): tic en que sale el ACK final + 2 por cada decisión equivocada + 2 por cada segmento que B descarta por no caber + 1 por cada error en la hoja. Si repites el mismo error en tics seguidos, cuenta una vez. La referencia es lo que tarda TCP jugando bien con las mismas pérdidas.</li>
      </ul>`;
  }

  /* ---------- Partida ---------- */

  function empezar() {
    const ids = [...Object.keys(ESCENARIOS), 'AZ'];
    const id = cfg.esc === 'sorpresa' ? ids[Math.floor(Math.random() * ids.length)] : cfg.esc;
    escReal = { ...(id === 'AZ' ? escenarioAzar() : ESCENARIOS[id]), rapida: cfg.rapida, fuera: cfg.fuera };
    refTic = Partida.simular(escReal).fin.tic;
    partida = new Partida(escReal, cfg.rol);
    siguienteTic();
  }

  function siguienteTic() {
    ultimaEval = null;
    if (!partida.empezarTic()) return final();
    borrador = { envia: false, hoja: {}, sn: '', an: '', w: '' };
    fase = 'jugando';
    juego();
  }

  function eventoHTML(rol, e) {
    if (rol === 'A') {
      if (e.tipo === 'ack') return `<li class="evento seg-B">ACK de B · <span class="num">AN = ${e.seg.an} · W = ${e.seg.w}</span>${e.duplicado ? `<small>Mismo AN que el anterior: no reconoce nada nuevo (${e.n}.º ACK duplicado).</small>` : ''}</li>`;
      if (e.tipo === 'rapida') return `<li class="evento malo">Tercer ACK duplicado con AN = ${e.desde}<small>B sigue pidiendo el ${e.desde}: lo más probable es que se haya perdido.</small></li>`;
      if (e.tipo === 'ack_viejo') return `<li class="evento seg-B">ACK de B · <span class="num">AN = ${e.seg.an} · W = ${e.seg.w}</span><small>Su AN no está entre el último que tenías y lo que has enviado: no cambia nada.</small></li>`;
      if (e.tipo === 'vence') return `<li class="evento malo">Vence tu temporizador de retransmisión<small>No te ha llegado a tiempo el ACK del ${e.desde}. No sabes si se perdió el segmento o el ACK.</small></li>`;
    } else {
      if (e.tipo === 'llegada') return `<li class="evento seg-A">Segmento de A · <span class="num">SN = ${e.seg.sn} · ${e.seg.datos} B (${r(e.seg.sn, e.seg.sn + e.seg.datos - 1)})</span><small>${e.hueco
        ? `Rellena el hueco${e.unidos.length ? `: ahora tienes en orden también ${e.unidos.map((f) => r(f.ini, f.fin)).join(', ')}` : ''}.`
        : 'Llega en orden y cabe: lo guardas en el búfer.'}</small></li>`;
      if (e.tipo === 'fuera_de_orden') return `<li class="evento aviso">Segmento de A · <span class="num">SN = ${e.seg.sn} · ${e.seg.datos} B (${r(e.seg.sn, e.seg.sn + e.seg.datos - 1)})</span><small>Fuera de orden: esperabas el ${e.espera}. Lo guardas aparte, a la espera de que llegue lo que falta.</small></li>`;
      if (e.tipo === 'descarte') {
        const m = { no_cabe: `no cabe en el búfer (te quedaban ${e.libre} B libres)`, duplicado: 'ya lo tenías (duplicado)', fuera_de_orden: `llega fuera de orden (esperabas el ${e.espera}) y no guardas lo que llega fuera de orden` }[e.motivo];
        return `<li class="evento malo">Segmento de A · <span class="num">SN = ${e.seg.sn} · ${e.seg.datos} B</span><small>Se descarta: ${m}.</small></li>`;
      }
      if (e.tipo === 'lectura') return `<li class="evento aviso">Tu aplicación ha leído <span class="num">${r(e.ini, e.fin)}</span></li>`;
    }
    return '';
  }

  function juego() {
    const rol = cfg.rol, t = partida.tic, ev = partida.eventos[rol];
    const previo = cuadernoPrevio();
    const verEval = fase === 'veredicto';
    h(`
      <header class="barra">
        <div class="marca"><h1>TCPGame</h1></div>
        <span class="chip ${rol}">${NOMBRE[rol]}</span>
        <span class="chip">Escenario ${cfg.esc === 'sorpresa' ? 'oculto' : escReal.id}</span>
        <span class="chip tic">Tic ${t}</span>
      </header>
      <div class="rejilla">
        <div class="col">
          <section class="panel">
            <h3>${t === 1 ? 'Ha llegado antes de este tic' : `Llegó a mitad del tic ${t - 1}: cuenta para tu decisión de ahora`}</h3>
            ${ev.length ? `<ul class="eventos">${ev.map((e) => eventoHTML(rol, e)).join('')}</ul>` : '<p class="vacio">No ha llegado nada.</p>'}
          </section>
          ${cfg.hoja ? `
          <section class="panel">
            <h3>Tu hoja de estado (después de lo que te ha llegado)</h3>
            <div class="hoja">
              ${CAMPOS[rol].map(([k, nombre, ayuda, def]) => `
                <div class="campo">
                  <label for="h-${k}">${nombre}<br><span class="ayuda">${ayuda}</span></label>
                  <input id="h-${k}" data-k="${k}" inputmode="numeric" autocomplete="off" ${verEval ? 'disabled' : ''}
                    value="${esc(borrador.hoja[k] ?? '')}" placeholder="${previo[k] ?? ''}">
                  <details class="def" data-def="${k}" ${abiertos.has(k) ? 'open' : ''}><summary>¿Qué es?</summary><p>${def}</p></details>
                </div>`).join('')}
            </div>
            <p class="ayuda" style="margin:.6rem 0 0">El valor gris es lo que apuntaste en el tic anterior.</p>
          </section>` : ''}
          <section class="panel">
            <h3>Tu tarjeta para este tic</h3>
            <div class="conmutador" role="group" aria-label="Decisión">
              <button type="button" data-envia="0" aria-pressed="${!borrador.envia}" ${verEval ? 'disabled' : ''}>No envío nada</button>
              <button type="button" data-envia="1" aria-pressed="${borrador.envia}" ${verEval ? 'disabled' : ''}>${rol === 'A' ? 'Envío un segmento' : 'Envío un ACK'}</button>
            </div>
            ${tarjetaHTML(rol, verEval)}
            ${verEval ? veredictoHTML(ultimaEval) : ''}
            <p class="ayuda" id="aviso" role="alert" style="margin:.6rem 0 0"></p>
            <div class="acciones">
              ${verEval
                ? '<button class="btn primario" id="seguir">Siguiente tic</button>'
                : '<button class="btn primario" id="entregar">Entregar la tarjeta</button>'}
            </div>
          </section>
        </div>
        <div class="col">
          <section class="panel fijos">
            <h3>Lo que sabes desde el principio</h3>
            ${fijosHTML(rol)}
          </section>
          <section class="panel">
            <h3>Tu cuaderno</h3>
            ${cuadernoHTML(rol)}
          </section>
        </div>
      </div>
    `);
    enlazarJuego();
  }

  function temporizadorTxt() {
    const f = partida.historia[partida.historia.length - 1].foto.A;
    return f.vence === null ? 'parado' : `en marcha, vence al empezar el tic ${f.vence}`;
  }

  function fijosHTML(rol) {
    return rol === 'A'
      ? `<dl><dt>Fichero</dt><dd>384 B, del 1024 al 1407</dd><dt>MSS</dt><dd>64 B por segmento</dd>
         <dt>W inicial de B</dt><dd>256 (anunciada en la apertura)</dd><dt>Tus segmentos</dt><dd>AN = 2048 · W = 512</dd>
         <dt>Temporizador</dt><dd>${escReal.rto} tics (lo lleva el juego)</dd>
         <dt>Retx. rápida</dt><dd>${escReal.rapida ? 'sí, al tercer ACK duplicado' : 'no'}</dd>
         <dt>Al vencer</dt><dd>${escReal.fuera === 'descarta' ? 'reenvías el más antiguo y luego toda la cola' : 'reenvías solo el más antiguo'}</dd>
         <dt>Ahora</dt><dd>${temporizadorTxt()}</dd></dl>`
      : `<dl><dt>BufferRecepcion</dt><dd>256 B</dd><dt>Primer octeto de A</dt><dd>1024</dd><dt>MSS</dt><dd>64 B</dd>
         <dt>W anunciada</dt><dd>256 en la apertura</dd><dt>Tus ACK</dt><dd>SN = 2048 · sin datos</dd>
         <dt>Fuera de orden</dt><dd>${escReal.fuera === 'descarta' ? 'lo descartas' : 'lo guardas'}</dd></dl>`;
  }

  function tarjetaHTML(rol, bloqueada) {
    const dis = !borrador.envia || bloqueada ? 'disabled' : '';
    const cls = `tarjeta ${rol}${borrador.envia ? '' : ' apagada'}`;
    if (rol === 'A') {
      return `<div class="${cls}">
        <div class="fila"><span>SN</span><input id="t-sn" inputmode="numeric" autocomplete="off" value="${esc(borrador.sn)}" ${dis} aria-label="Número de secuencia"></div>
        <div class="fila"><span>Datos</span><span>64 B <span class="fijo" id="t-rango">${borrador.sn !== '' && !isNaN(+borrador.sn) ? `(${r(+borrador.sn, +borrador.sn + 63)})` : ''}</span></span></div>
        <div class="fila fijo"><span>AN</span><span>2048</span></div>
        <div class="fila fijo"><span>W</span><span>512</span></div>
      </div>`;
    }
    return `<div class="${cls}">
      <div class="fila fijo"><span>SN</span><span>2048 · ACK</span></div>
      <div class="fila"><span>AN</span><input id="t-an" inputmode="numeric" autocomplete="off" value="${esc(borrador.an)}" ${dis} aria-label="Número de reconocimiento"></div>
      <div class="fila"><span>W</span><input id="t-w" inputmode="numeric" autocomplete="off" value="${esc(borrador.w)}" ${dis} aria-label="Ventana anunciada"></div>
      <div class="fila fijo"><span>Datos</span><span>0 B</span></div>
    </div>`;
  }

  function enlazarJuego() {
    app.querySelectorAll('details.def').forEach((d) => d.addEventListener('toggle', () => { if (d.open) abiertos.add(d.dataset.def); else abiertos.delete(d.dataset.def); }));
    app.querySelectorAll('.hoja input').forEach((i) => i.addEventListener('input', () => { borrador.hoja[i.dataset.k] = i.value.trim(); }));
    app.querySelectorAll('[data-envia]').forEach((b) => b.addEventListener('click', () => {
      guardarTarjeta(); borrador.envia = b.dataset.envia === '1'; juego();
      const foco = document.getElementById(cfg.rol === 'A' ? 't-sn' : 't-an');
      if (borrador.envia && foco) foco.focus();
    }));
    ['t-sn', 't-an', 't-w'].forEach((id) => {
      const i = document.getElementById(id);
      if (!i) return;
      i.addEventListener('input', () => {
        guardarTarjeta();
        const rg = document.getElementById('t-rango');
        if (rg) rg.textContent = i.value !== '' && !isNaN(+i.value) ? `(${r(+i.value, +i.value + 63)})` : '';
      });
    });
    app.querySelectorAll('input').forEach((i) => i.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); entregar(); }
    }));
    const ent = document.getElementById('entregar');
    if (ent) ent.addEventListener('click', entregar);
    const seg = document.getElementById('seguir');
    if (seg) { seg.addEventListener('click', siguienteTic); seg.focus(); }
  }

  function guardarTarjeta() {
    for (const [id, k] of [['t-sn', 'sn'], ['t-an', 'an'], ['t-w', 'w']]) {
      const i = document.getElementById(id);
      if (i) borrador[k] = i.value.trim();
    }
  }

  const entero = (v) => v !== '' && /^\d+$/.test(v);

  function entregar() {
    if (fase !== 'jugando') return;
    guardarTarjeta();
    const aviso = document.getElementById('aviso');
    const malos = [];
    if (cfg.hoja) for (const [k] of CAMPOS[cfg.rol]) if (!entero(borrador.hoja[k] ?? '')) malos.push('h-' + k);
    let accion = null;
    if (borrador.envia) {
      if (cfg.rol === 'A') {
        if (!entero(borrador.sn)) malos.push('t-sn');
        else accion = { sn: +borrador.sn, an: P.SN_B, w: P.W_A, datos: P.MSS };
      } else {
        if (!entero(borrador.an)) malos.push('t-an');
        if (!entero(borrador.w)) malos.push('t-w');
        if (!malos.includes('t-an') && !malos.includes('t-w')) accion = { sn: P.SN_B, an: +borrador.an, w: +borrador.w, datos: 0 };
      }
    }
    app.querySelectorAll('input.mal').forEach((i) => i.classList.remove('mal'));
    if (malos.length) {
      malos.forEach((id) => document.getElementById(id)?.classList.add('mal'));
      aviso.textContent = 'Rellena con números enteros los campos marcados.';
      document.getElementById(malos[0])?.focus();
      return;
    }
    const hoja = cfg.hoja ? Object.fromEntries(CAMPOS[cfg.rol].map(([k]) => [k, +borrador.hoja[k]])) : null;
    ultimaEval = partida.cerrarTic(accion, hoja);
    if (cfg.correccion === 'tic') { fase = 'veredicto'; juego(); }
    else siguienteTic();
  }

  function veredictoHTML(ev) {
    if (!ev) return '';
    const malCampos = ev.campos.filter((c) => !c.ok);
    return `<div class="veredicto ${ev.ok ? 'ok' : 'mal'}" style="margin-top:12px">
      <strong>${ev.decision.ok ? 'Decisión correcta' : 'Decisión incorrecta'}</strong>
      ${esc(ev.decision.texto)}
      ${malCampos.length ? `<ul>${malCampos.map((c) => `<li><code>${c.nombre}</code>: era <b class="num">${c.correcto}</b> (pusiste ${c.tuyo})</li>`).join('')}</ul>` : ''}
    </div>`;
  }

  function cuadernoPrevio() {
    for (let i = partida.historia.length - 2; i >= 0; i--) {
      const x = partida.historia[i];
      if (x.humano && x.humano.hoja) return x.humano.hoja;
    }
    return {};
  }

  function resumenEventos(rol, ev) {
    if (!ev.length) return '—';
    return ev.map((e) => {
      if (e.tipo === 'ack' || e.tipo === 'ack_viejo') return `ACK ${e.seg.an}, W ${e.seg.w}${e.duplicado ? ' (dup.)' : ''}`;
      if (e.tipo === 'vence') return 'vence el temporizador';
      if (e.tipo === 'rapida') return '3.er ACK duplicado';
      if (e.tipo === 'llegada') return `llega ${r(e.seg.sn, e.seg.sn + e.seg.datos - 1)}${e.hueco ? ' (rellena el hueco)' : ''}`;
      if (e.tipo === 'fuera_de_orden') return `llega ${r(e.seg.sn, e.seg.sn + e.seg.datos - 1)} fuera de orden`;
      if (e.tipo === 'descarte') return `descarta SN ${e.seg.sn}`;
      if (e.tipo === 'lectura') return `lee ${r(e.ini, e.fin)}`;
      return '';
    }).join('; ');
  }

  function resumenAccion(rol, a) {
    if (!a) return '—';
    return rol === 'A' ? `SN ${a.sn}` : `ACK ${a.an}, W ${a.w}`;
  }

  function cuadernoHTML(rol) {
    const filas = partida.historia.filter((x) => x.humano);
    if (!filas.length) return '<p class="vacio">Aquí irá lo que apuntes en cada tic.</p>';
    const corto = { ultimoByteEnviado: 'Enviado', ultimoByteReconocido: 'Reconocido', ultimoByteRecibido: 'Recibido', ultimoByteLeido: 'Leído', ventRecepcion: 'W' };
    const cab = cfg.hoja ? CAMPOS[rol].map(([k, n]) => `<th title="${n}">${corto[k]}</th>`).join('') : '';
    return `<div class="tabla-scroll"><table>
      <thead><tr><th>Tic</th><th title="Llegó a mitad del tic anterior">Tenías nuevo</th>${cab}<th>Enviaste</th>${cfg.correccion === 'tic' ? '<th></th>' : ''}</tr></thead>
      <tbody>${filas.map((x) => `<tr>
        <td class="num">${x.tic}</td>
        <td>${esc(resumenEventos(rol, x.eventos[rol]))}</td>
        ${cfg.hoja ? CAMPOS[rol].map(([k]) => `<td class="num">${x.humano.hoja[k]}</td>`).join('') : ''}
        <td class="num">${resumenAccion(rol, x.humano.accion)}</td>
        ${cfg.correccion === 'tic' ? `<td>${x.humano.evaluacion.ok ? '<span class="si" aria-label="bien">✓</span>' : '<span class="no" aria-label="mal">✗</span>'}</td>` : ''}
      </tr>`).join('')}</tbody></table></div>`;
  }

  /* ---------- Final ---------- */

  function puntuacion() {
    const jugadas = partida.historia.filter((x) => x.humano);
    // Una racha de tics seguidos con el mismo error (p. ej. dejar de enviar) cuenta una sola vez.
    let errDec = 0, previo = null;
    for (const x of jugadas) {
      const d = x.humano.evaluacion.decision;
      if (!d.ok && d.codigo !== previo) errDec++;
      previo = d.ok ? null : d.codigo;
    }
    const decMal = jugadas.filter((x) => !x.humano.evaluacion.decision.ok).length;
    const errCampos = jugadas.reduce((n, x) => n + x.humano.evaluacion.campos.filter((c) => !c.ok).length, 0);
    const desc = partida.registro.filter((s) => s.descartado && s.motivo === 'no_cabe').length;
    // Solo cuenta como transferido si B tiene de verdad el fichero entero en orden.
    const completo = partida.fin.motivo === 'completo' && partida.B.rec >= P.FIN_A - 1;
    const total = completo ? partida.fin.tic + 2 * desc + 2 * errDec + errCampos : null;
    return { jugadas: jugadas.length, errDec, decMal, errCampos, desc, completo, total, ref: refTic };
  }

  /** Cómo acabó la transferencia, mirando lo que tiene B de verdad, no lo que cree A. */
  function resultado(s) {
    const B = partida.B, fin = partida.fin, ref = refTic;
    const trozos = [];
    for (let sn = P.SN_A; sn < P.FIN_A; sn += P.MSS) {
      const ult = sn + P.MSS - 1;
      trozos.push({ sn, ult, estado: ult <= B.rec ? 'orden' : B.fuera.some((f) => f.ini <= sn && f.fin >= ult) ? 'fuera' : 'falta' });
    }
    const faltan = trozos.filter((t) => t.estado === 'falta'), fuera = trozos.filter((t) => t.estado === 'fuera');
    const lista = (xs) => xs.map((t) => r(t.sn, t.ult)).join(', ');
    const jugadas = partida.historia.filter((x) => x.humano);
    const primerError = jugadas.find((x) => !x.humano.evaluacion.decision.ok);
    const errTxt = primerError ? ` La primera decisión distinta de TCP fue en el tic ${primerError.tic}: ${primerError.humano.evaluacion.decision.texto}` : '';
    const huecoTxt = (faltan.length ? ` Le faltan ${lista(faltan)}.` : '') + (fuera.length ? ` Tiene ${lista(fuera)}, pero fuera de orden: detrás de un hueco, sin poder entregarlo a la aplicación.` : '');

    if (fin.motivo === 'completo' && B.rec < P.FIN_A - 1) {
      // A da el fichero por entregado, pero B no lo tiene: B confirmó algo que no tenía en orden.
      const mentira = partida.historia.find((x) => x.enviados && x.enviados.B && x.enviados.B.an > x.foto.B.ultimoByteRecibido + 1);
      const quien = mentira
        ? ` En el tic ${mentira.tic} B envió AN = ${mentira.enviados.B.an} cuando solo tenía en orden hasta el ${mentira.foto.B.ultimoByteRecibido}: A dio esos octetos por entregados y ya no los volvió a enviar.`
        : '';
      return { clase: 'err', titulo: fuera.length ? 'Fichero desordenado y con huecos' : 'Faltan fragmentos del fichero',
        texto: `A cree que ha terminado (el ACK con AN = 1408 salió en el tic ${fin.tic}), pero B no tiene el fichero entero en orden.${huecoTxt}${quien}`, trozos };
    }
    if (fin.motivo !== 'completo') {
      return B.rec >= P.FIN_A - 1
        ? { clase: 'err', titulo: 'La transferencia no terminó', texto: `B tiene el fichero entero, pero a los ${P.MAX_TICS} tics A todavía no lo sabía: no le llegó el ACK con AN = 1408.${errTxt}`, trozos }
        : { clase: 'err', titulo: 'Faltan fragmentos: la transferencia se quedó a medias', texto: `A los ${P.MAX_TICS} tics la conexión seguía sin avanzar.${huecoTxt}${errTxt}`, trozos };
    }
    if (fin.tic > ref) {
      return { clase: 'warn', titulo: `Fichero completo, pero más lento: ${fin.tic - ref} tic${fin.tic - ref > 1 ? 's' : ''} más que TCP`,
        texto: `B tiene el fichero entero y en orden, y el ACK final salió en el tic ${fin.tic}; TCP lo habría conseguido en el ${ref}.${errTxt}`, trozos };
    }
    if (fin.tic < ref) {
      return { clase: 'warn', titulo: 'Fichero completo y antes que TCP, pero saltándote una regla',
        texto: `B tiene el fichero entero y en orden, y el ACK final salió en el tic ${fin.tic}, antes que con TCP (${ref}). Fue suerte: decidiste con información que A no tenía, y en otra partida esa misma decisión puede salir mal.${errTxt}`, trozos };
    }
    const nota = primerError ? ` Eso sí, no siempre decidiste como TCP: ${s.decMal} decisión${s.decMal > 1 ? 'es' : ''} distinta${s.decMal > 1 ? 's' : ''}.` : '';
    return { clase: 'ok', titulo: 'Fichero completo, de la mejor manera posible',
      texto: `B tiene el fichero entero y en orden, y el ACK final salió en el tic ${fin.tic}, igual que con TCP.${nota}`, trozos };
  }

  function resultadoHTML(res) {
    const nombre = { orden: 'en orden', fuera: 'fuera de orden', falta: 'falta' };
    return `<section class="resultado ${res.clase}">
      <h2>${res.titulo}</h2>
      <p>${esc(res.texto)}</p>
      <div class="fichero" role="list" aria-label="El fichero en B">
        ${res.trozos.map((t) => `<div class="trozo ${t.estado}" role="listitem" title="${nombre[t.estado]}"><span class="num">${t.sn}</span><small>${nombre[t.estado]}</small></div>`).join('')}
      </div>
      <p class="ayuda" style="margin:.5rem 0 0">El fichero tal como lo tiene B al final, en trozos de 64 B.</p>
    </section>`;
  }

  function final() {
    fase = 'final';
    const rol = cfg.rol, s = puntuacion(), e = escReal, res = resultado(s);
    h(`
      <header class="barra">
        <div class="marca"><h1>TCPGame</h1><span>Fin de la partida</span></div>
        <span class="chip ${rol}">${NOMBRE[rol]}</span>
        <span class="chip">Escenario ${e.id} · ${e.nombre}</span>
      </header>
      ${resultadoHTML(res)}
      <p class="ayuda">Lo que no sabías: ${descripcionEscenario(e)}</p>
      <div class="resumen">
        <div class="cifra"><b>${s.completo ? s.total : '—'}</b><span>Puntuación (referencia ${s.ref})</span></div>
        <div class="cifra"><b>${s.jugadas - s.decMal}/${s.jugadas}</b><span>Decisiones correctas${s.decMal > s.errDec ? ` (${s.errDec} errores distintos)` : ''}</span></div>
        ${cfg.hoja ? `<div class="cifra"><b>${s.errCampos}</b><span>Errores en la hoja</span></div>` : ''}
        <div class="cifra"><b>${s.desc}</b><span>Segmentos que no cabían en el búfer de B</span></div>
      </div>
      <div class="col">
        <section class="panel diagrama">
          <h3>Lo que pasó en realidad</h3>
          ${diagramaSVG()}
          <div class="leyenda">
            <span><i style="background:var(--a)"></i>Datos de A</span>
            <span><i style="background:var(--b)"></i>ACK de B</span>
            <span><i style="background:var(--b);height:9px;width:9px;opacity:.8"></i>64 B en orden sin leer</span>
            <span><i style="background:var(--b-soft);border:1px dashed var(--b);height:9px;width:9px"></i>64 B guardados fuera de orden</span>
            <span><i style="border-top:2px dashed var(--muted);height:0"></i>✗ se pierde en la red</span>
            <span>A la izquierda, lo que sabía A: en vuelo / W</span>
            <span><b class="no">✗</b> junto al tic: te equivocaste · en B: segmento descartado (etiqueta en rojo)</span>
          </div>
        </section>
        <section class="panel">
          <h3>Tic a tic: tú frente a TCP</h3>
          ${tablaFinalHTML(rol)}
        </section>
      </div>
      <div class="acciones">
        <button class="btn primario" id="otra">Otra partida igual</button>
        <button class="btn" id="papel">Jugar con el otro papel</button>
        <button class="btn" id="menu">Volver al inicio</button>
      </div>
    `);
    document.getElementById('otra').addEventListener('click', empezar);
    document.getElementById('papel').addEventListener('click', () => { cfg.rol = cfg.rol === 'A' ? 'B' : 'A'; empezar(); });
    document.getElementById('menu').addEventListener('click', inicio);
  }

  function descripcionEscenario(e) {
    const ord = (n) => `${n}.º`;
    const lect = e.L === 0 ? 'la aplicación de B leía cada segmento en cuanto llegaba' : `la aplicación de B tardaba ${e.L} tics en leer cada segmento`;
    const p = [...e.perdidas.datos.map((d) => `el segmento SN = ${d.sn} (${ord(d.envio)} envío)`), ...e.perdidas.acks.map((k) => `el ${ord(k)} ACK de B`)];
    return `${lect}; ${p.length ? `la red perdía ${p.join(' y ')}` : 'la red no perdía nada'}; temporizador de A: ${e.rto} tics${e.rapida ? '; con retransmisión rápida' : '; sin retransmisión rápida'}; B ${e.fuera === 'descarta' ? 'descartaba' : 'guardaba'} lo que llegaba fuera de orden.`;
  }

  function tablaFinalHTML(rol) {
    const filas = partida.historia.filter((x) => x.humano);
    return `<div class="tabla-scroll"><table>
      <thead><tr><th>Tic</th><th title="Llegó a mitad del tic anterior">Tenías nuevo</th><th>Tú</th><th>TCP</th><th></th></tr></thead>
      <tbody>${filas.map((x) => {
        const ev = x.humano.evaluacion, malos = ev.campos.filter((c) => !c.ok);
        return `<tr>
          <td class="num">${x.tic}</td>
          <td>${esc(resumenEventos(rol, x.eventos[rol]))}</td>
          <td class="num">${resumenAccion(rol, x.humano.accion)}</td>
          <td class="num">${resumenAccion(rol, x.humano.esperada.accion)}</td>
          <td>${ev.ok ? '<span class="si" aria-label="bien">✓</span>' : `<span class="no" aria-label="mal">✗</span>
            <div class="ayuda">${esc(ev.decision.ok ? '' : ev.decision.texto)}${malos.map((c) => ` ${c.nombre}: era ${c.correcto}, pusiste ${c.tuyo}.`).join('')}</div>`}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
  }

  function diagramaSVG() {
    const p = partida, ultimoSeg = p.registro.reduce((m, s) => Math.max(m, s.tic), 0);
    const T = Math.max(ultimoSeg + 1, p.historia.length ? p.historia[p.historia.length - 1].tic : 1);
    const W = 640, top = 46, fila = 34, H = top + T * fila + 12;
    const xT = 14, xA = 196, xB = 452, xC = 476, cel = 30;
    const y = (t) => top + (t - 1) * fila;
    const o = [];
    o.push(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Diagrama de secuencia de la partida">`);
    o.push(`<text class="txt cab" x="${xA}" y="20" text-anchor="middle">A</text><text class="txt cab" x="${xB}" y="20" text-anchor="middle">B</text>`);
    o.push(`<text class="txt tenue" x="${xA - 14}" y="36" text-anchor="end">A sabe: en vuelo / W</text>`);
    o.push(`<text class="txt tenue" x="${xC}" y="36">búfer de B (4 × 64 B)</text>`);
    for (let t = 1; t <= T; t++) {
      o.push(`<line class="guia" x1="${xT + 30}" x2="${xA}" y1="${y(t)}" y2="${y(t)}" />`);
      o.push(`<text class="txt tenue" x="${xT}" y="${y(t) + 4}">t${t}</text>`);
      const x = p.historia.find((hh) => hh.tic === t);
      if (x && x.humano && !x.humano.evaluacion.ok) o.push(`<text class="lbl-err" x="${xT + 26}" y="${y(t) + 4}" style="font-size:12px">✗</text>`);
      if (x) {
        const a = x.foto.A, b = x.foto.B;
        o.push(`<text class="txt" x="${xA - 14}" y="${y(t) + 4}" text-anchor="end">${a.enVuelo} / ${a.ventRecepcion}</text>`);
        // Cada casilla es un hueco de 64 B del búfer, a partir del primer octeto sin leer.
        const base = b.ultimoByteLeido + 1;
        for (let k = 0; k < 4; k++) {
          const ini = base + 64 * k;
          const clase = ini + 63 <= b.ultimoByteRecibido ? ' llena' : b.fuera.some((f) => f.ini === ini) ? ' fuera' : '';
          o.push(`<rect class="celda${clase}" x="${xC + k * (cel + 4)}" y="${y(t) - 8}" width="${cel}" height="14" rx="4" />`);
        }
      }
    }
    o.push(`<line class="vida" x1="${xA}" x2="${xA}" y1="28" y2="${H - 6}" /><line class="vida" x1="${xB}" x2="${xB}" y1="28" y2="${H - 6}" />`);
    o.push(`<defs>
      <marker id="pa" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1.5,1.5 L9,5 L1.5,8.5" fill="none" stroke="var(--a)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></marker>
      <marker id="pb" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M1.5,1.5 L9,5 L1.5,8.5" fill="none" stroke="var(--b)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></marker>
    </defs>`);
    for (const s of p.registro) {
      const y0 = y(s.tic), y1 = y(s.tic) + fila / 2;
      if (s.perdido) {
        const [x0, xf] = s.lado === 'A' ? [xA, xB] : [xB, xA];
        const xm = (x0 + xf) / 2, ym = (y0 + y1) / 2;
        o.push(`<line class="flecha-${s.lado}" x1="${x0}" y1="${y0}" x2="${xm}" y2="${ym}" stroke-dasharray="4 3" />`);
        o.push(`<path class="cruz" d="M${xm - 6},${ym - 6} l12,12 m0,-12 l-12,12" />`);
        o.push(s.lado === 'A'
          ? `<text class="lbl-A" x="${xA + 8}" y="${y0 - 3}">SN ${s.sn}${s.retx ? ' retx' : ' · 64 B'}</text>`
          : `<text class="lbl-B" x="${xB - 8}" y="${y0 - 3}" text-anchor="end">AN ${s.an} · W ${s.w}</text>`);
        o.push(`<text class="lbl-err" x="${xm + 10}" y="${ym - 6}">se pierde</text>`);
        continue;
      }
      if (s.lado === 'A') {
        const xf = s.descartado ? xB - 2 : xB;
        o.push(`<line class="flecha-A" x1="${xA}" y1="${y0}" x2="${xf}" y2="${y1}" marker-end="url(#pa)" />`);
        o.push(`<text class="lbl-A${s.descartado ? ' descartado' : ''}" x="${xA + 8}" y="${y0 - 3}">SN ${s.sn}${s.retx ? ' retx' : ' · 64 B'}</text>`);
        if (s.descartado) o.push(`<path class="cruz" d="M${xB - 22},${y1 - 6} l10,10 m0,-10 l-10,10" />`);
      } else {
        o.push(`<line class="flecha-B" x1="${xB}" y1="${y0}" x2="${xA}" y2="${y1}" marker-end="url(#pb)" />`);
        o.push(`<text class="lbl-B" x="${xB - 8}" y="${y0 - 3}" text-anchor="end">AN ${s.an} · W ${s.w}</text>`);
      }
    }
    for (const x of p.historia) {
      if (x.eventos.A.some((e) => e.tipo === 'vence')) o.push(`<text class="lbl-err" x="${xA - 14}" y="${y(x.tic) - 8}" text-anchor="end">vence el temporizador</text>`);
      else if (x.eventos.A.some((e) => e.tipo === 'rapida')) o.push(`<text class="lbl-err" x="${xA - 14}" y="${y(x.tic) - 8}" text-anchor="end">3.er ACK dup.</text>`);
    }
    if (p.fin.motivo === 'completo') {
      const tf = p.fin.tic + 1;
      if (tf <= T) o.push(`<text class="txt cab" x="${xA + 8}" y="${y(tf) + 4}">${p.B.rec >= P.FIN_A - 1 ? 'A sabe que ha llegado todo' : 'A cree que ha llegado todo'}</text>`);
    }
    o.push('</svg>');
    return o.join('');
  }

  inicio();
})();

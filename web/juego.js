/* TCPGame: interfaz del modo individual (el alumno contra el simulador). */
(function () {
  'use strict';
  const { P, ESCENARIOS, Partida, escenarioAzar, CC } = window.MotorTCP;
  const app = document.getElementById('app');

  const NOMBRE = { A: 'Cliente A · emisor', B: 'Servidor B · receptor' };
  // Parámetros por defecto (pantalla de inicio, donde aún no hay partida); en juego se usa `partida.par`.
  const PAR_DEF = { segmentos: (P.FIN_A - P.SN_A) / P.MSS, bufer: P.BUFER, fin: P.FIN_A };
  const par = () => (partida ? partida.par : PAR_DEF);
  const camposDe = (q) => ({
    A: [['ultimoByteEnviado', 'UltimoByteEnviado', 'último octeto que has enviado',
         'El número del último octeto de datos <b>nuevos</b> que has metido en la red. Un segmento con SN = 1152 y 64 B lleva del 1152 al 1215, así que después de enviarlo vale 1215. Una retransmisión no lo cambia, porque esos octetos ya estaban enviados. Antes de enviar nada vale 1023, el octeto anterior al primero.'],
        ['ultimoByteReconocido', 'UltimoByteReconocido', 'AN del último ACK − 1',
         'El último octeto que B te ha confirmado. El AN de un ACK es el <b>siguiente</b> octeto que B espera, así que lo confirmado llega hasta AN − 1: con AN = 1088, B tiene hasta el 1087. Un ACK duplicado no lo cambia. Antes del primer ACK vale 1023.<br>UltimoByteEnviado − UltimoByteReconocido son los octetos que tienes en vuelo: enviados y aún sin confirmar.'],
        ['ventRecepcion', 'VentRecepcion', 'W del último ACK',
         `La ventana que anunció B en el último ACK que te ha llegado, aunque sea duplicado: es el sitio que B te asegura a partir del AN. Antes del primer ACK vale ${q.bufer}, la W de la apertura. Puedes enviar si (UltimoByteEnviado − UltimoByteReconocido) + 64 ≤ VentRecepcion.`]],
    B: [['ultimoByteRecibido', 'UltimoByteRecibido', 'último octeto recibido en orden (sin contar lo que tengas fuera de orden)',
         'El último octeto que tienes en orden, sin huecos desde el 1024. Si tienes del 1024 al 1087 y te llega del 1152 al 1215, sigue valiendo 1087: lo de después del hueco se guarda aparte. Cuando llega el segmento que rellena el hueco, salta hasta el final de lo guardado. Antes de recibir nada vale 1023. El AN de tus ACK es UltimoByteRecibido + 1.'],
        ['ultimoByteLeido', 'UltimoByteLeido', 'último octeto que ha leído tu aplicación',
         'El último octeto que tu aplicación ha sacado del búfer. Cambia solo cuando ves el aviso «Tu aplicación ha leído…». Antes de que lea nada vale 1023.<br>UltimoByteRecibido − UltimoByteLeido es lo que ocupa tu búfer: recibido y todavía sin leer.'],
        ['ventRecepcion', 'VentRecepcion', 'la W que anunciarías ahora',
         `El sitio libre que puedes ofrecer a A: VentRecepcion = ${q.bufer} − (UltimoByteRecibido − UltimoByteLeido). Lo guardado fuera de orden no se descuenta. Es la W que pondrías en un ACK enviado en este tic.`]],
  });
  const dec = (v) => String(Math.round(v * 1e4) / 1e4).replace('.', ',');   // número con coma decimal
  const ccActivo = () => !!(partida && escReal && escReal.cc);
  const MODOS = ['AL', 'EC', 'RR'];
  const MODO_TXT = { AL: 'arranque lento', EC: 'evitación de la congestión', RR: 'recuperación rápida' };

  // Las tres variables más de la hoja de A con control de congestión. variante: 'reno', 'tahoe' o null (reglas del inicio: las dos).
  const camposCC = (variante) => {
    const tercero = variante === 'tahoe'
      ? 'umbral = VC/2, VC = 1 y vuelves a AL, como si hubiera vencido el temporizador (en esta partida, TCP Tahoe); los ACK duplicados siguientes no cambian nada.'
      : variante === 'reno'
        ? 'umbral = VC/2 y VC = umbral + 3, en modo RR (en esta partida, TCP Reno). Cada ACK duplicado más suma 1. El ACK nuevo que llega después fija VC = umbral y pasas a EC, sin sumar nada más. Con VC = 8: umbral = 4, VC = 7 y, con el siguiente duplicado, 8.'
        : 'en Reno, umbral = VC/2 y VC = umbral + 3, en modo RR (cada duplicado más suma 1; el ACK nuevo fija VC = umbral y pasas a EC); en Tahoe, umbral = VC/2, VC = 1 y vuelves a AL.';
    return [
      ['vc', 'VentCongestion (VC)', 'en MSS: 5, 4,5 o 4 + 2/4',
       `La ventana de congestión de A, en MSS (1 MSS = un segmento de 64 B). Se escribe como un número («5»), con decimales («4,5») o como N + c/N («4 + 2/4»). Cómo cambia según el modo:<br>
        <b>AL</b>: suma 1 por cada segmento que reconoce un ACK nuevo; un ACK que reconoce 2 segmentos suma 2 (de 3 pasa a 5). Si N llega al umbral, pasas a EC y los segmentos que quedan de ese mismo ACK ya cuentan como EC (con umbral 5 y VC = 4, un ACK de 2 segmentos deja 5 + 1/5).<br>
        <b>EC</b>: VC = N + c/N y cada segmento reconocido suma 1 a c; cuando c llega a N, c vuelve a 0 y N sube 1. Con VC = 4: 4 + 1/4, 4 + 2/4, 4 + 3/4 y, con el cuarto segmento reconocido, 5.<br>
        <b>Tercer ACK duplicado</b>: ${tercero}<br>
        <b>Vence el temporizador</b> (en cualquier modo): umbral = VC/2, VC = 1 y vuelves a AL. Con VC = 7: umbral = 3,5.<br>
        Para enviar, los segmentos en vuelo (todo lo enviado sin reconocer, también lo que se haya perdido) tienen que ser menos que ⌊VC⌋ y, además, el segmento tiene que caber en la W de B: A está limitado por mín{VC, W}. Con VC = 4,5 puedes tener 4 segmentos en vuelo.`],
      ['umbral', 'umbralAL (Umbral)', 'en MSS; admite coma decimal',
       'El umbral del arranque lento, en MSS. Mientras N no lo alcanza, estás en AL; al alcanzarlo pasas a EC. No cambia hasta que hay una pérdida: al tercer ACK duplicado o al vencer el temporizador, umbral = VC/2 (con VC = 7, umbral = 3,5; si estabas en RR cuenta la VC que tenías, inflada con los +3 y los duplicados). Con umbral = 5 y VC = 4 en AL, un ACK nuevo de 1 segmento deja VC = 5, que ya alcanza el umbral: EC.'],
      ['modo', 'Modo', 'AL, EC o RR',
       `En qué fase del control de congestión estás. <b>AL</b> (arranque lento): la VC crece 1 por cada segmento reconocido, hasta alcanzar el umbral. <b>EC</b> (evitación de la congestión): crece 1 MSS por cada VC segmentos reconocidos (N + c/N). <b>RR</b> (recuperación rápida${variante === 'tahoe' ? ', que Tahoe no usa' : ''}): empieza al tercer ACK duplicado y acaba con el siguiente ACK nuevo, que te pasa a EC. Cuando vence el temporizador, siempre vuelves a AL. Ejemplo: en EC con VC = 6, el tercer duplicado te pasa a RR; el ACK nuevo, a EC; y si vence el temporizador, a AL con VC = 1.`],
    ];
  };
  // CAMPOS.A / CAMPOS.B según la partida en curso (A añade VC, umbral y modo en las cartas de congestión)
  const CAMPOS = new Proxy({}, { get: (_, rol) => (rol === 'A' && ccActivo() ? camposDe(par()).A.concat(camposCC(escReal.cc.variante)) : camposDe(par())[rol]) });
  const abiertos = new Set();   // desplegables «¿Qué es?» abiertos (sobreviven al redibujar)

  const cfg = { rol: 'A', esc: 'sorpresa', correccion: 'final', hoja: true, ventana: false, rapida: true, fuera: 'almacena', variante: 'reno' };
  let partida = null, escReal = null, refTic = null, fase = 'inicio', borrador = null, ultimaEval = null;

  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const r = (ini, fin) => `${ini}–${fin}`;
  const h = (html) => { app.innerHTML = html; };

  /* ---------- Inicio ---------- */

  function inicio() {
    fase = 'inicio'; partida = null;   // sin partida: los textos hablan del caso por defecto
    h(`
      <header class="barra"><div class="marca"><h1>TCPGame</h1><span>Control de flujo y de congestión, desde dentro de un extremo</span></div></header>
      <section class="intro">
        <h2>Juegas un extremo de una conexión TCP. El otro lo juega el ordenador.</h2>
        <p>Solo ves lo que le llega a tu lado y lo que apuntas en tu hoja, igual que TCP. No sabes qué ha enviado el otro, qué va de camino ni cuándo lee la aplicación de B. Al final se muestra el diagrama completo.</p>
      </section>
      <div class="papeles" role="group" aria-label="Papel">
        ${['A', 'B'].map((x) => `
          <button type="button" class="papel ${x}" data-rol="${x}" aria-pressed="${cfg.rol === x}">
            <strong>${NOMBRE[x]}</strong>
            <span>${x === 'A'
              ? 'Tu aplicación te ha dado un fichero que enviar. Decide en cada tic si cabe otro segmento: en la ventana que te anuncia B y, en las cartas de congestión, también en tu ventana de congestión.'
              : 'Recibes los segmentos de A en un búfer. Decide cuándo enviar el ACK y qué AN y qué W anuncias.'}</span>
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
            <optgroup label="Control de congestión">
              ${Object.values(ESCENARIOS).filter((e) => e.grupo === 'congestion').map((e) => `<option value="${e.id}">${e.id} · ${e.nombre}</option>`).join('')}
            </optgroup>
          </select>
        </label>
        <label>Variante de TCP
          <select id="o-var">
            <option value="reno">Reno (la de los ejemplos)</option>
            <option value="tahoe">Tahoe</option>
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
        <label class="check"><input type="checkbox" id="o-ventana" ${cfg.ventana ? 'checked' : ''}> Dibujar la ventana con lo que apuntas en la hoja</label>
        <label class="check"><input type="checkbox" id="o-rapida" ${cfg.rapida ? 'checked' : ''}> Retransmisión rápida (3 ACK duplicados)</label>
        <p class="nota-opc" id="nota-opc"></p>
      </div>
      <div class="acciones"><button class="btn primario" id="empezar">Empezar la partida</button></div>
      <details class="reglas panel"><summary>Reglas</summary>${reglasHTML()}</details>
    `);
    document.getElementById('o-esc').value = cfg.esc;
    document.getElementById('o-corr').value = cfg.correccion;
    document.getElementById('o-fuera').value = cfg.fuera;
    document.getElementById('o-var').value = cfg.variante;
    document.getElementById('o-esc').addEventListener('change', disponibilidad);
    document.getElementById('o-hoja').addEventListener('change', disponibilidad);
    disponibilidad();
    app.querySelectorAll('.papel').forEach((b) => b.addEventListener('click', () => { cfg.rol = b.dataset.rol; leerOpciones(); inicio(); }));
    document.getElementById('empezar').addEventListener('click', () => { leerOpciones(); empezar(); });
  }

  const esCongestion = (id) => !!(ESCENARIOS[id] && ESCENARIOS[id].cc);

  /** Qué opciones se aplican a la carta elegida (fuera de orden y retransmisión rápida no, en las C; la variante, solo en las C). */
  function disponibilidad() {
    const id = document.getElementById('o-esc').value, c = esCongestion(id), sorpresa = id === 'sorpresa';
    document.getElementById('o-fuera').disabled = c;
    document.getElementById('o-rapida').disabled = c;
    document.getElementById('o-var').disabled = !c && !sorpresa;
    document.getElementById('o-ventana').disabled = !document.getElementById('o-hoja').checked;   // el dibujo sale de la hoja
    document.getElementById('nota-opc').textContent = c
      ? 'En las cartas de congestión, B siempre guarda lo que llega fuera de orden y la retransmisión rápida está siempre activa: esas dos opciones no se aplican.'
      : sorpresa ? 'Si sale una carta de congestión, se usa la variante elegida y no se aplican las opciones de fuera de orden ni de retransmisión rápida.'
      : 'La variante de TCP solo se aplica a las cartas de congestión.';
  }

  function leerOpciones() {
    const e = document.getElementById('o-esc'), c = document.getElementById('o-corr'), k = document.getElementById('o-hoja'), q = document.getElementById('o-rapida');
    if (q) cfg.rapida = q.checked;
    const fo = document.getElementById('o-fuera');
    if (fo) cfg.fuera = fo.value;
    const va = document.getElementById('o-var');
    if (va) cfg.variante = va.value;
    if (e) cfg.esc = e.value;
    if (c) cfg.correccion = c.value;
    if (k) cfg.hoja = k.checked;
    const vz = document.getElementById('o-ventana');
    if (vz) cfg.ventana = vz.checked;
  }

  function reglasHTML() {
    const q = par();
    return `
      <ul>
        <li><b>Tiempo en tics.</b> Un segmento sale al comienzo de un tic y llega a mitad de ese mismo tic. El otro lo tiene en cuenta en su decisión del tic siguiente. Por eso, lo que ves al empezar el tic <i>n</i> llegó a mitad del tic <i>n</i> − 1 y ya cuenta para lo que decidas en el tic <i>n</i>. Como mucho, un segmento por tic.</li>
        <li><b>Datos de partida.</b> MSS = 64 B. A envía del ${P.SN_A} al ${q.fin - 1} (${q.segmentos} segmentos). B tiene <code>BufferRecepcion</code> = ${q.bufer} B y en la apertura anunció W = ${q.bufer}. Los ACK de B llevan SN = 2048.</li>
        <li><b>A puede enviar</b> si <code>(UltimoByteEnviado − UltimoByteReconocido) + 64 ≤ VentRecepcion</code>, con la W del último ACK. Si no cabe, espera: en esta versión no hay segmento de sondeo.</li>
        <li><b>Variables de la hoja</b> (los nombres de Kurose). Todas son números de octeto y empiezan en 1023, el anterior al primero.
          <ul>
            ${['A', 'B'].map((x) => CAMPOS[x].map(([, n, , d]) => `<li><b>${n}</b>${x === 'A' ? ' (A)' : ' (B)'}: ${d}</li>`).join('')).join('')}
          </ul></li>
        <li><b>B calcula</b> <code>VentRecepcion = ${q.bufer} − (UltimoByteRecibido − UltimoByteLeido)</code> en el tic en que envía el ACK.</li>
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
        <li><b>Retransmisión rápida</b> (si está activada). Un ACK es duplicado si trae el mismo AN que el último, A tiene datos sin reconocer y no agranda la W (si la agranda, es una actualización de ventana). Al llegar el <b>tercer</b> ACK duplicado, A reenvía el segmento más antiguo sin reconocer sin esperar al temporizador. La cuenta vuelve a 0 con un ACK que reconoce algo nuevo y cuando vence el temporizador. Si está desactivada, como en los ejercicios de control de flujo, los ACK duplicados no hacen reenviar.</li>
        <li><b>Si te sales de la ventana.</b> B descarta lo que no cabe en su búfer y responde enseguida con el AN que espera.</li>
        <li><b>Control de congestión (cartas C).</b> Además de la W de B, A tiene su propia ventana: la <code>VentCongestion</code> (VC), en MSS, que sube y baja según lo que le pasa a la red, y el <code>umbralAL</code>. Tres modos: <b>AL</b> (arranque lento), <b>EC</b> (evitación de la congestión) y <b>RR</b> (recuperación rápida). En estas cartas la retransmisión rápida está siempre activa y B guarda lo que llega fuera de orden: esas dos opciones no se aplican.
          <ul>
            <li><b>Cuándo envía A.</b> Los segmentos en vuelo (todo lo enviado sin reconocer, también lo perdido: A no sabe qué se ha perdido) tienen que ser menos que ⌊VC⌋ y, además, el segmento tiene que caber en la W de B. Es decir, A está limitado por mín{VC, W}. Con VC = 4,5 puede haber 4 segmentos en vuelo. Una retransmisión no pasa por esta cuenta.</li>
            <li><b>AL.</b> Cada segmento que reconoce un ACK nuevo suma 1 a la VC: un ACK que reconoce 2 segmentos suma 2. Cuando N, la parte entera, alcanza el umbral, se pasa a EC; los segmentos que quedan de ese mismo ACK ya cuentan como EC. Con umbral = 5 y VC = 4, un ACK de 2 segmentos deja VC = 5 + 1/5.</li>
            <li><b>EC.</b> VC = N + c/N. Cada segmento reconocido suma 1 a c y, cuando c llega a N, c vuelve a 0 y N sube 1: la VC crece 1 MSS por cada VC segmentos reconocidos. Con VC = 4: 4 + 1/4, 4 + 2/4, 4 + 3/4 y, con el cuarto, 5.</li>
            <li><b>Tercer ACK duplicado.</b> En Reno: umbral = VC/2, VC = umbral + 3 y modo RR (con VC = 8: umbral = 4, VC = 7). Cada ACK duplicado más suma 1. El primer ACK nuevo fija VC = umbral y pasa a EC, sin sumar los segmentos que reconoce. En Tahoe: umbral = VC/2, VC = 1 y AL; los duplicados siguientes no cambian nada. En las dos, A retransmite el más antiguo sin esperar al temporizador.</li>
            <li><b>Vence el temporizador</b> (en cualquier modo): umbral = VC/2 (si estabas en RR, la VC inflada que tenías), VC = 1 y AL. Si en un mismo tic llegan ACK y vence el temporizador, primero cuentan los ACK.</li>
            <li><b>En tu hoja</b> apuntas la VC, el umbral y el modo que tienes <i>después</i> de lo que te ha llegado en el tic. La VC se puede escribir como «5», «4,5» o «4 + 2/4». El juego no te dice el nuevo valor: es lo que tienes que calcular.</li>
          </ul></li>
        <li><b>Puntuación</b> (menos es mejor): tic en que sale el ACK final + 2 por cada decisión equivocada + 2 por cada segmento que B descarta por no caber + 1 por cada error en la hoja. Si repites el mismo error en tics seguidos, cuenta una vez. La referencia es lo que tarda TCP jugando bien con las mismas pérdidas.</li>
      </ul>`;
  }

  /* ---------- Partida ---------- */

  function empezar() {
    const ids = [...Object.keys(ESCENARIOS), 'AZ'];
    const id = cfg.esc === 'sorpresa' ? ids[Math.floor(Math.random() * ids.length)] : cfg.esc;
    const base = id === 'AZ' ? escenarioAzar() : ESCENARIOS[id];
    escReal = { ...base, rapida: cfg.rapida, fuera: cfg.fuera };
    // Con congestión, la retransmisión rápida va siempre y B guarda lo fuera de orden (el motor ignora esas dos opciones).
    if (base.cc) escReal = { ...escReal, rapida: true, fuera: 'almacena', cc: { ...base.cc, variante: cfg.variante } };
    refTic = Partida.simular(escReal).fin.tic;
    partida = new Partida(escReal, cfg.rol);
    siguienteTic();
  }

  function siguienteTic() {
    ultimaEval = null;
    if (!partida.empezarTic()) return final();
    borrador = { envia: false, hoja: {}, sn: '', an: '', w: '' };
    // El modo del tic anterior queda preseleccionado, marcado como «previo» hasta que el alumno pulse uno.
    if (ccActivo() && cfg.rol === 'A' && cfg.hoja && cuadernoPrevio().modo) { borrador.hoja.modo = cuadernoPrevio().modo; borrador.modoPrevio = true; }
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
            ${ev.length ? `<ul class="eventos">${ev.map((e) => eventoHTML(rol, e)).join('')}</ul>` : '<p class="vacio">No ha llegado nada</p>'}
          </section>
          ${cfg.hoja ? `
          <section class="panel">
            <h3>Tu hoja de estado (después de lo que te ha llegado)</h3>
            <div class="hoja">
              ${CAMPOS[rol].map(([k, nombre, ayuda, def]) => campoHTML(k, nombre, ayuda, def, previo, verEval)).join('')}
            </div>
            <p class="ayuda nota">El valor gris es lo que apuntaste en el tic anterior${ccActivo() && rol === 'A' ? '; en Modo, el borde discontinuo marca el del tic anterior (púlsalo para confirmarlo o elige otro)' : ''}</p>
            ${cfg.ventana ? `<div class="ventana" id="ventana" aria-live="off">${ventanaHTML(rol)}</div>` : ''}
          </section>` : ''}
          <section class="panel">
            <h3>Tu tarjeta para este tic</h3>
            <div class="conmutador" role="group" aria-label="Decisión">
              <button type="button" data-envia="0" aria-pressed="${!borrador.envia}" ${verEval ? 'disabled' : ''}>No envío nada</button>
              <button type="button" data-envia="1" aria-pressed="${borrador.envia}" ${verEval ? 'disabled' : ''}>${rol === 'A' ? 'Envío un segmento' : 'Envío un ACK'}</button>
            </div>
            ${tarjetaHTML(rol, verEval)}
            ${verEval ? veredictoHTML(ultimaEval) : ''}
            <p class="ayuda nota" id="aviso" role="alert"></p>
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

  function campoHTML(k, nombre, ayuda, def, previo, verEval) {
    const detalle = `<details class="def" data-def="${k}" ${abiertos.has(k) ? 'open' : ''}><summary>¿Qué es?</summary><p>${def}</p></details>`;
    if (k === 'modo') {
      const sel = borrador.hoja.modo;
      return `<div class="campo modo">
        <span id="lbl-modo" class="lbl">${nombre}<br><span class="ayuda">${ayuda}</span></span>
        <div class="seg" id="h-modo" role="group" aria-labelledby="lbl-modo">
          ${MODOS.map((m) => `<button type="button" data-modo="${m}" title="${MODO_TXT[m]}" aria-pressed="${sel === m}" class="${sel === m && borrador.modoPrevio ? 'previo' : ''}" ${verEval ? 'disabled' : ''}>${m}</button>`).join('')}
        </div>
        ${detalle}
      </div>`;
    }
    const texto = k === 'vc' || k === 'umbral';
    return `<div class="campo">
      <label for="h-${k}">${nombre}<br><span class="ayuda">${ayuda}</span></label>
      <input id="h-${k}" data-k="${k}" inputmode="${texto ? (k === 'umbral' ? 'decimal' : 'text') : 'numeric'}" autocomplete="off" ${verEval ? 'disabled' : ''}
        value="${esc(borrador.hoja[k] ?? '')}" placeholder="${esc(previo[k] ?? '')}">
      ${detalle}
    </div>`;
  }

  /* ---------- La ventana, dibujada con lo que el alumno ha apuntado ---------- */

  /** Valor de la hoja para el dibujo: lo tecleado en este tic o, si el campo sigue vacío, lo del tic anterior. null si no hay número. */
  function valorHoja(k, previo) {
    const v = borrador.hoja[k] ?? '';
    const crudo = String(v !== '' ? v : (previo[k] ?? ''));
    if (k === 'vc') { const n = CC.leer(crudo); return typeof n === 'number' && isFinite(n) && n >= 0 ? n : null; }
    return /^\d+$/.test(crudo) ? +crudo : null;
  }

  /**
   * Barra con el flujo de octetos de A (una celda por segmento) pintada SOLO con lo que hay en la hoja del alumno
   * y con lo que sabe desde el principio: no usa el estado real de la partida, así que no adelanta ninguna corrección.
   *   A: confirmado | enviado sin confirmar | usable; borde izquierdo AN y borde derecho AN + W (o AN + mín{⌊VC⌋·MSS, W}).
   *   B: leído por la aplicación | en el búfer sin leer | sitio que anuncia (W); AN, AN + W y el final del búfer.
   */
  function ventanaHTML(rol) {
    const previo = cuadernoPrevio(), q = par(), M = P.MSS, lo = P.SN_A;
    const v = (k) => valorHoja(k, previo);
    const cc = rol === 'A' && ccActivo();
    const faltan = CAMPOS[rol].filter(([k]) => k !== 'umbral' && k !== 'modo' && v(k) === null).map(([, n]) => n.replace(/ \(.*\)$/, ''));
    const titulo = rol === 'A' ? 'Tu ventana, según lo que has apuntado' : 'Tu búfer y la ventana que anuncias, según lo que has apuntado';
    if (faltan.length) return `<h4>${titulo}</h4><p class="vacio">Apunta ${faltan.join(', ')} para ver el dibujo.</p>`;

    let zonas, marcas, lineas, leyenda;
    const avisos = [];
    if (rol === 'A') {
      const env = v('ultimoByteEnviado'), rec = v('ultimoByteReconocido'), w = v('ventRecepcion');
      const an = rec + 1, sig = Math.max(env + 1, an);
      const limW = an + w, limVC = cc ? an + Math.floor(v('vc')) * M : null;
      const borde = cc ? Math.min(limW, limVC) : limW;
      if (env < rec) avisos.push('UltimoByteEnviado queda por detrás de UltimoByteReconocido.');
      if (sig > borde) avisos.push('Lo enviado sin confirmar no cabe en la ventana.');
      zonas = [[lo, an, 'conf'], [an, sig, 'vuelo'], [sig, borde, 'usable']];
      marcas = [[an, 'an', `AN = ${an}`], [sig, 'sig', `siguiente SN = ${sig}`]];
      if (cc) {
        const mandaVC = limVC <= limW;
        marcas.push([borde, 'borde', `AN + ${mandaVC ? '⌊VC⌋·64' : 'W'} = ${borde}`]);
        if (limVC !== limW) marcas.push([mandaVC ? limW : limVC, 'otro', `AN + ${mandaVC ? 'W' : '⌊VC⌋·64'} = ${mandaVC ? limW : limVC}`]);
        lineas = [`Ventana = mín{⌊VC⌋·64, W} = mín{${Math.floor(v('vc')) * M}, ${w}} = ${borde - an} B`];
      } else {
        marcas.push([borde, 'borde', `AN + W = ${borde}`]);
        lineas = [`Ventana = W = ${w} B`];
      }
      lineas.push(`en vuelo: ${sig - an} B`, `usable: ${Math.max(0, borde - sig)} B`);
      leyenda = [['conf', 'confirmado'], ['vuelo', 'enviado sin confirmar'], ['usable', 'usable'], ['fuera', 'fuera de ventana']];
    } else {
      const rcb = v('ultimoByteRecibido'), lei = v('ultimoByteLeido'), w = v('ventRecepcion');
      const an = rcb + 1, borde = an + w, finBufer = lei + 1 + q.bufer;
      if (lei > rcb) avisos.push('UltimoByteLeido queda por delante de UltimoByteRecibido.');
      zonas = [[lo, lei + 1, 'conf'], [lei + 1, an, 'bufer'], [an, borde, 'usable']];
      marcas = [[an, 'an', `AN = ${an}`], [borde, 'borde', `AN + W = ${borde}`], [finBufer, 'otro', 'fin del búfer']];
      lineas = [`En el búfer, sin leer: ${Math.max(0, rcb - lei)} B`, `anuncias W = ${w} B`];
      leyenda = [['conf', 'leído por tu aplicación'], ['bufer', 'en el búfer, sin leer'], ['usable', 'sitio que anuncias (W)'], ['fuera', 'fuera de ventana']];
    }

    // Lo que se ve: el fichero y dos segmentos más; lo que cae más allá se pinta en el borde, con una flecha.
    const hi = q.fin + 2 * M, n = (hi - lo) / M;
    const ANCHO = 520, X0 = 6, cw = (ANCHO - 2 * X0) / n, Y = 36, ALTO = 26;
    const X = (b) => X0 + (Math.max(lo, Math.min(hi, b)) - lo) / M * cw;
    const paso = Math.ceil(n / 9);
    const escala = Array.from({ length: n + 1 }, (_, i) => (i % paso === 0
      ? `<text class="v-t" x="${X(lo + i * M)}" y="26" text-anchor="${i === 0 ? 'start' : i === n ? 'end' : 'middle'}">${lo + i * M}</text>` : '')).join('');
    const rects = zonas.filter(([a, b]) => X(b) > X(a)).map(([a, b, c]) => `<rect class="v-${c}" x="${X(a)}" y="${Y}" width="${X(b) - X(a)}" height="${ALTO}"/>`).join('');
    const celdas = Array.from({ length: n }, (_, i) => `<rect class="v-celda" x="${X0 + i * cw}" y="${Y}" width="${cw}" height="${ALTO}"/>`).join('');
    const finFichero = `<text class="v-t" x="${X(q.fin)}" y="11" text-anchor="middle">fin del fichero ▾</text>`;
    // Una fila de rótulos por marca, para que no se pisen; el texto se ancla hacia dentro cerca de los extremos.
    // Primero todas las líneas y después los textos (con halo), para que una línea no tache el rótulo de otra marca.
    const yRot = (i) => Y + ALTO + 16 + i * 14;
    const rotulos = marcas.map(([b, c], i) => `<line class="v-${c}" x1="${X(b)}" y1="${Y - 5}" x2="${X(b)}" y2="${yRot(i) - 10}"/>`).join('')
      + marcas.map(([b, c, txt], i) => {
        const x = X(b), ancla = x < ANCHO * 0.3 ? 'start' : x > ANCHO * 0.7 ? 'end' : 'middle';
        return `<text class="v-l ${c}" x="${x + (ancla === 'start' ? 4 : ancla === 'end' ? -4 : 0)}" y="${yRot(i)}" text-anchor="${ancla}">${b < lo ? '← ' : ''}${esc(txt)}${b > hi ? ' →' : ''}</text>`;
      }).join('');
    const altoSvg = Y + ALTO + 16 + marcas.length * 14;
    const desc = `${titulo}. ${marcas.map((m) => m[2]).join('; ')}. ${lineas.join('; ')}.`;
    return `<h4>${titulo}</h4>
      <svg viewBox="0 0 ${ANCHO} ${altoSvg}" role="img" aria-label="${esc(desc)}">
        ${escala}${rects}${celdas}${finFichero}${rotulos}
      </svg>
      <p class="v-res">${lineas.map(esc).join(' · ')}</p>
      ${avisos.length ? `<p class="v-aviso">${avisos.map(esc).join(' ')}</p>` : ''}
      <div class="leyenda">${leyenda.map(([c, t]) => `<span><i class="caja v-${c}"></i>${t}</span>`).join('')}</div>
      <p class="ayuda nota">Solo usa tu hoja y lo que sabes desde el principio: si un valor está mal, el dibujo sale mal.${rol === 'B' ? ' Lo que guardes fuera de orden no aparece.' : ''}</p>`;
  }

  function temporizadorTxt() {
    const f = partida.historia[partida.historia.length - 1].foto.A;
    return f.vence === null ? 'parado' : `en marcha, vence al empezar el tic ${f.vence}`;
  }

  function fijosHTML(rol) {
    const cc = ccActivo() ? escReal.cc : null;
    if (cc && rol === 'A') {
      return `<dl><dt>Fichero</dt><dd>${par().segmentos * P.MSS} B, del ${P.SN_A} al ${par().fin - 1}</dd><dt>MSS</dt><dd>64 B por segmento</dd>
         <dt>W inicial de B</dt><dd>${par().bufer} (anunciada en la apertura)</dd><dt>Tus segmentos</dt><dd>AN = 2048 · W = 512</dd>
         <dt>VC de partida</dt><dd>${dec(cc.vc)} MSS</dd><dt>Umbral de partida</dt><dd>${dec(cc.umbral)} MSS</dd><dt>Modo de partida</dt><dd>${cc.modo}</dd>
         <dt>Variante</dt><dd>${cc.variante === 'tahoe' ? 'Tahoe' : 'Reno'}</dd>
         <dt>Envías si</dt><dd>en vuelo &lt; ⌊VC⌋ y cabe en la W</dd>
         <dt>Temporizador</dt><dd>${escReal.rto} tics (lo lleva el juego)</dd>
         <dt>Retx. rápida</dt><dd>activa: al tercer ACK duplicado</dd>
         <dt>Al vencer</dt><dd>reenvías solo el más antiguo</dd>
         <dt>Ahora</dt><dd>${temporizadorTxt()}</dd></dl>`;
    }
    return rol === 'A'
      ? `<dl><dt>Fichero</dt><dd>${par().segmentos * P.MSS} B, del ${P.SN_A} al ${par().fin - 1}</dd><dt>MSS</dt><dd>64 B por segmento</dd>
         <dt>W inicial de B</dt><dd>${par().bufer} (anunciada en la apertura)</dd><dt>Tus segmentos</dt><dd>AN = 2048 · W = 512</dd>
         <dt>Temporizador</dt><dd>${escReal.rto} tics (lo lleva el juego)</dd>
         <dt>Retx. rápida</dt><dd>${escReal.rapida ? 'sí, al tercer ACK duplicado' : 'no'}</dd>
         <dt>Al vencer</dt><dd>${escReal.fuera === 'descarta' ? 'reenvías el más antiguo y luego toda la cola' : 'reenvías solo el más antiguo'}</dd>
         <dt>Ahora</dt><dd>${temporizadorTxt()}</dd></dl>`
      : `<dl><dt>BufferRecepcion</dt><dd>${par().bufer} B</dd><dt>Primer octeto de A</dt><dd>1024</dd><dt>MSS</dt><dd>64 B</dd>
         <dt>W anunciada</dt><dd>${par().bufer} en la apertura</dd><dt>Tus ACK</dt><dd>SN = 2048 · sin datos</dd>
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
    app.querySelectorAll('.hoja input').forEach((i) => i.addEventListener('input', () => {
      borrador.hoja[i.dataset.k] = i.value.trim();
      const vz = document.getElementById('ventana');
      if (vz) vz.innerHTML = ventanaHTML(cfg.rol);   // el dibujo sigue lo que se va tecleando
    }));
    app.querySelectorAll('[data-modo]').forEach((b) => b.addEventListener('click', () => {
      borrador.hoja.modo = b.dataset.modo; borrador.modoPrevio = false;
      app.querySelectorAll('[data-modo]').forEach((x) => { x.setAttribute('aria-pressed', String(x === b)); x.classList.remove('previo'); });
      document.getElementById('h-modo').classList.remove('mal');
    }));
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
    const ccNum = (v) => { const n = CC.leer(v ?? ''); return typeof n === 'number' && isFinite(n) && n >= 0; };
    const validos = { vc: ccNum, umbral: ccNum, modo: (v) => MODOS.includes(v) };
    if (cfg.hoja) for (const [k] of CAMPOS[cfg.rol]) if (!(validos[k] || ((v) => entero(v ?? '')))(borrador.hoja[k])) malos.push('h-' + k);
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
    app.querySelectorAll('input.mal, .seg.mal').forEach((i) => i.classList.remove('mal'));
    if (malos.length) {
      malos.forEach((id) => document.getElementById(id)?.classList.add('mal'));
      const cc = malos.some((id) => ['h-vc', 'h-umbral', 'h-modo'].includes(id));
      aviso.textContent = cc ? 'Revisa los campos marcados: números enteros en los octetos; la VC y el umbral, un número (5, 4,5 o 4 + 2/4); y elige un modo.' : 'Rellena con números enteros los campos marcados.';
      const f = document.getElementById(malos[0]);
      if (f) (f.tagName === 'INPUT' ? f : f.querySelector('button'))?.focus();
      return;
    }
    // VC, umbral y modo se entregan tal como los teclea el alumno; el motor los interpreta.
    const hoja = cfg.hoja ? Object.fromEntries(CAMPOS[cfg.rol].map(([k]) => [k, validos[k] ? borrador.hoja[k] : +borrador.hoja[k]])) : null;
    ultimaEval = partida.cerrarTic(accion, hoja);
    if (cfg.correccion === 'tic') { fase = 'veredicto'; juego(); }
    else siguienteTic();
  }

  function veredictoHTML(ev) {
    if (!ev) return '';
    const malCampos = ev.campos.filter((c) => !c.ok);
    const hoja = partida.historia[partida.historia.length - 1].humano.hoja;
    const cambios = cfg.rol === 'A' ? cambiosCC(partida.eventos.A) : [];
    return `<div class="veredicto ${ev.ok ? 'ok' : 'mal'}">
      <strong>${ev.decision.ok ? 'Decisión correcta' : 'Decisión incorrecta'}</strong>
      ${esc(ev.decision.texto)}
      ${malCampos.length ? `<ul>${malCampos.map((c) => `<li><code>${c.nombre}</code>: era <b class="num">${esc(campoCorrecto(c))}</b> (pusiste ${esc(campoTuyo(c, hoja))})</li>`).join('')}</ul>` : ''}
      ${cambios.length ? `<ul class="cambios">${cambios.map((t) => `<li>${esc(t)}</li>`).join('')}</ul>` : ''}
    </div>`;
  }

  // Lo que se enseña de un campo de la hoja que falló: el valor correcto y lo que escribió el alumno, tal cual.
  const campoCorrecto = (c) => (c.campo === 'umbral' ? dec(c.correcto) : c.correcto);
  const campoTuyo = (c, hoja) => (hoja && ['vc', 'umbral', 'modo'].includes(c.campo) ? hoja[c.campo] : c.tuyo);

  /** Qué ha cambiado en VC, umbral y modo (solo lo que cambia), «antes → después». */
  function cambioTxt(cc) {
    const a = cc.antes, d = cc.despues, t = [`VC ${a.vcTexto} → ${d.vcTexto}`];
    if (a.umbral !== d.umbral) t.push(`umbral ${dec(a.umbral)} → ${dec(d.umbral)}`);
    if (a.modo !== d.modo) t.push(`modo ${a.modo} → ${d.modo}`);
    return t.join(', ');
  }
  /** Una línea por evento de A con cambio de congestión (para el veredicto y la tabla final). */
  function cambiosCC(evs) {
    return evs.filter((e) => e.cc).map((e) => {
      const k = e.cc.k;
      const causa = e.tipo === 'vence' ? 'Vence el temporizador' : e.tipo === 'rapida' ? 'Tercer ACK duplicado'
        : e.duplicado ? `ACK duplicado n.º ${e.n}` : `ACK nuevo (reconoce ${k} segmento${k === 1 ? '' : 's'})`;
      return `${causa}: ${cambioTxt(e.cc)}`;
    });
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
    const corto = { ultimoByteEnviado: 'Enviado', ultimoByteReconocido: 'Reconocido', ultimoByteRecibido: 'Recibido', ultimoByteLeido: 'Leído', ventRecepcion: 'W', vc: 'VC', umbral: 'Umbral', modo: 'Modo' };
    const cab = cfg.hoja ? CAMPOS[rol].map(([k, n]) => `<th title="${n}">${corto[k]}</th>`).join('') : '';
    return `<div class="tabla-scroll"><table${ccActivo() && rol === 'A' && cfg.hoja ? ' class="ancha"' : ''}>
      <thead><tr><th>Tic</th><th title="Llegó a mitad del tic anterior">Tenías nuevo</th>${cab}<th>Enviaste</th>${cfg.correccion === 'tic' ? '<th></th>' : ''}</tr></thead>
      <tbody>${filas.map((x) => `<tr>
        <td class="num">${x.tic}</td>
        <td>${esc(resumenEventos(rol, x.eventos[rol]))}</td>
        ${cfg.hoja ? CAMPOS[rol].map(([k]) => `<td class="num">${esc(x.humano.hoja[k])}</td>`).join('') : ''}
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
    // Lo mismo con la hoja: un valor equivocado que se arrastra de tic en tic (mismo valor tuyo, mismo valor correcto) cuenta una vez.
    let errCampos = 0;
    const arrastre = {};
    for (const x of jugadas) for (const c of x.humano.evaluacion.campos) {
      const marca = c.ok ? null : `${c.tuyo}|${c.valor ?? c.correcto}`;
      if (marca !== null && marca !== arrastre[c.campo]) errCampos++;
      arrastre[c.campo] = marca;
    }
    const desc = partida.registro.filter((s) => s.descartado && s.motivo === 'no_cabe').length;
    // Solo cuenta como transferido si B tiene de verdad el fichero entero en orden.
    const completo = partida.fin.motivo === 'completo' && partida.B.rec >= partida.par.fin - 1;
    const total = completo ? partida.fin.tic + 2 * desc + 2 * errDec + errCampos : null;
    return { jugadas: jugadas.length, errDec, decMal, errCampos, desc, completo, total, ref: refTic };
  }

  /** Cómo acabó la transferencia, mirando lo que tiene B de verdad, no lo que cree A. */
  function resultado(s) {
    const B = partida.B, fin = partida.fin, ref = refTic, finAN = partida.par.fin;
    const trozos = [];
    for (let sn = P.SN_A; sn < partida.par.fin; sn += P.MSS) {
      const ult = sn + P.MSS - 1;
      trozos.push({ sn, ult, estado: ult <= B.rec ? 'orden' : B.fuera.some((f) => f.ini <= sn && f.fin >= ult) ? 'fuera' : 'falta' });
    }
    const faltan = trozos.filter((t) => t.estado === 'falta'), fuera = trozos.filter((t) => t.estado === 'fuera');
    const lista = (xs) => xs.map((t) => r(t.sn, t.ult)).join(', ');
    const jugadas = partida.historia.filter((x) => x.humano);
    const primerError = jugadas.find((x) => !x.humano.evaluacion.decision.ok);
    const errTxt = primerError ? ` La primera decisión distinta de TCP fue en el tic ${primerError.tic}: ${primerError.humano.evaluacion.decision.texto}` : '';
    const huecoTxt = (faltan.length ? ` Le faltan ${lista(faltan)}.` : '') + (fuera.length ? ` Tiene ${lista(fuera)}, pero fuera de orden: detrás de un hueco, sin poder entregarlo a la aplicación.` : '');

    if (fin.motivo === 'completo' && B.rec < finAN - 1) {
      // A da el fichero por entregado, pero B no lo tiene: B confirmó algo que no tenía en orden.
      const mentira = partida.historia.find((x) => x.enviados && x.enviados.B && x.enviados.B.an > x.foto.B.ultimoByteRecibido + 1);
      const quien = mentira
        ? ` En el tic ${mentira.tic} B envió AN = ${mentira.enviados.B.an} cuando solo tenía en orden hasta el ${mentira.foto.B.ultimoByteRecibido}: A dio esos octetos por entregados y ya no los volvió a enviar.`
        : '';
      return { clase: 'err', titulo: fuera.length ? 'Fichero desordenado y con huecos' : 'Faltan fragmentos del fichero',
        texto: `A cree que ha terminado (el ACK con AN = ${finAN} salió en el tic ${fin.tic}), pero B no tiene el fichero entero en orden.${huecoTxt}${quien}`, trozos };
    }
    if (fin.motivo !== 'completo') {
      return B.rec >= finAN - 1
        ? { clase: 'err', titulo: 'La transferencia no terminó', texto: `B tiene el fichero entero, pero a los ${P.MAX_TICS} tics A todavía no lo sabía: no le llegó el ACK con AN = ${finAN}.${errTxt}`, trozos }
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

  // Trozos por fila de la tira: hasta 6 en una fila; más, repartidos a partes iguales.
  const columnasFichero = (n) => Math.ceil(n / Math.ceil(n / 6));

  function resultadoHTML(res) {
    const nombre = { orden: 'en orden', fuera: 'fuera de orden', falta: 'falta' };
    return `<section class="resultado ${res.clase}">
      <h2>${res.titulo}</h2>
      <p>${esc(res.texto)}</p>
      <div class="fichero" role="list" style="--cols:${columnasFichero(res.trozos.length)}" aria-label="El fichero en B">
        ${res.trozos.map((t) => `<div class="trozo ${t.estado}" role="listitem" title="${nombre[t.estado]}"><span class="num">${t.sn}</span><small>${nombre[t.estado]}</small></div>`).join('')}
      </div>
      <p class="ayuda nota">El fichero tal como lo tiene B al final, en trozos de ${P.MSS} B</p>
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
        ${e.cc ? `<span class="chip">TCP ${e.cc.variante === 'tahoe' ? 'Tahoe' : 'Reno'}</span>` : ''}
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
          ${escReal.cc ? `<div class="tabla-scroll">${diagramaSVG()}</div>` : diagramaSVG()}
          <div class="leyenda">
            <span><i style="background:var(--a)"></i>Datos de A</span>
            <span><i style="background:var(--b)"></i>ACK de B</span>
            <span><i style="background:var(--b);height:8px;width:8px;opacity:.85"></i>64 B en orden sin leer</span>
            <span><i style="background:var(--b-soft);border:1px dashed var(--b);height:8px;width:8px"></i>64 B guardados fuera de orden</span>
            <span><i style="border-top:2px dashed var(--muted);height:0"></i>✗ se pierde en la red</span>
            <span>${e.cc ? 'A la izquierda, lo que sabía A: VC y modo, y en vuelo / W (fondo marcado: tics en que cambian la VC, el umbral o el modo)' : 'A la izquierda, lo que sabía A: en vuelo / W'}</span>
            <span><b class="no">✗</b> junto al tic: te equivocaste · en B: segmento descartado (etiqueta en rojo)</span>
          </div>
        </section>
        ${e.cc ? graficaVC() : ''}
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
    if (e.cc) {
      const c = e.cc, bu = partida.par.bufer;
      return `${lect}; ${p.length ? `la red perdía ${p.join(' y ')}` : 'la red no perdía nada'}; temporizador de A: ${e.rto} tics; búfer de B: ${bu} B; A empezaba con VC = ${dec(c.vc)} MSS, umbralAL = ${dec(c.umbral)} MSS y en ${c.modo} (${MODO_TXT[c.modo]}); variante de TCP: ${c.variante === 'tahoe' ? 'Tahoe' : 'Reno'}.`;
    }
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
          <td>${esc(resumenEventos(rol, x.eventos[rol]))}${rol === 'A' ? cambiosCC(x.eventos.A).map((t) => `<span class="cambio-cc">${esc(t)}</span>`).join('') : ''}</td>
          <td class="num">${resumenAccion(rol, x.humano.accion)}</td>
          <td class="num">${resumenAccion(rol, x.humano.esperada.accion)}</td>
          <td>${ev.ok ? '<span class="si" aria-label="bien">✓</span>' : `<span class="no" aria-label="mal">✗</span>
            <div class="ayuda">${esc(ev.decision.ok ? '' : ev.decision.texto)}${malos.map((c) => ` ${c.nombre}: era ${esc(campoCorrecto(c))}, pusiste ${esc(campoTuyo(c, x.humano.hoja))}.`).join('')}</div>`}</td>
        </tr>`;
      }).join('')}</tbody></table></div>`;
  }

  /** Gráfica de la VC, el umbral y los segmentos en vuelo, tic a tic (con congestión). */
  function graficaVC() {
    const hs = partida.historia, T = hs[hs.length - 1].tic;
    const pts = hs.map((x) => {
      const a = x.foto.A, ev = x.eventos.A.find((e) => e.tipo === 'vence') || x.eventos.A.find((e) => e.tipo === 'rapida');
      return { t: x.tic, vc: a.vc, vt: a.vcTexto, um: a.umbral, modo: a.modo, vuelo: a.vueloSeg, ev: ev ? ev.tipo : null };
    });
    const W = 760, H = 320, ml = 46, mr = 64, mt = 38, mb = 44, pw = W - ml - mr, ph = H - mt - mb;
    const mx = Math.max(...pts.map((q) => Math.max(q.vc, q.um, q.vuelo)));
    const paso = mx <= 8 ? 1 : mx <= 16 ? 2 : mx <= 40 ? 5 : 10, ymax = Math.ceil((mx * 1.05) / paso) * paso;
    const bw = pw / T, xi = (t) => ml + (t - 1) * bw, xc = (t) => xi(t) + bw / 2, yv = (v) => mt + ph * (1 - v / ymax);
    const o = [`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Gráfica de la ventana de congestión, el umbral y los segmentos en vuelo en cada tic" style="min-width:520px">`];
    // franjas por modo (tics seguidos con el mismo modo)
    for (let i = 0; i < pts.length;) {
      let j = i; while (j + 1 < pts.length && pts[j + 1].modo === pts[i].modo) j++;
      o.push(`<rect class="g-${pts[i].modo}" x="${xi(pts[i].t)}" y="${mt}" width="${(j - i + 1) * bw}" height="${ph}" />`);
      o.push(`<text class="g-modo" x="${xi(pts[i].t) + (j - i + 1) * bw / 2}" y="${mt + 14}" text-anchor="middle">${pts[i].modo}</text>`);
      i = j + 1;
    }
    for (let v = 0; v <= ymax; v += paso) {
      o.push(`<line class="${v === 0 ? 'g-eje' : 'g-grid'}" x1="${ml}" x2="${W - mr}" y1="${yv(v)}" y2="${yv(v)}" />`);
      o.push(`<text class="g-t" x="${ml - 8}" y="${yv(v) + 4}" text-anchor="end">${v}</text>`);
    }
    o.push(`<text class="g-t" x="${ml - 8}" y="${mt - 8}" text-anchor="end">MSS</text>`);
    const cada = Math.ceil(T / Math.floor(pw / 26));
    for (const q of pts) if ((q.t - 1) % cada === 0) o.push(`<text class="g-t" x="${xc(q.t)}" y="${H - mb + 16}" text-anchor="middle">${q.t}</text>`);
    o.push(`<text class="g-t" x="${W - mr}" y="${H - 6}" text-anchor="end">tic</text>`);
    // segmentos en vuelo: columnas finas, serie secundaria
    for (const q of pts) if (q.vuelo > 0) {
      const w = Math.min(14, bw * 0.45), y0 = yv(q.vuelo);
      o.push(`<rect class="g-vuelo" x="${xc(q.t) - w / 2}" y="${y0}" width="${w}" height="${yv(0) - y0}" rx="3" />`);
    }
    const escal = (clave) => pts.map((q, i) => `${i === 0 ? 'M' : 'V'}${i === 0 ? xi(q.t) : yv(q[clave])}${i === 0 ? ' ' + yv(q[clave]) : ''} H${xi(q.t + 1)}`).join(' ');
    o.push(`<path class="g-um" d="${escal('um')}" /><path class="g-vc" d="${escal('vc')}" />`);
    // marcas de pérdida: tercer ACK duplicado y vencimiento
    // Dos filas de rótulos; si con muchas pérdidas seguidas no cabe otro sin pisar, se queda la marca sin rótulo (está en la tabla).
    const ocupado = [-Infinity, -Infinity];
    for (const q of pts) if (q.ev) {
      const txt = q.ev === 'vence' ? 'vence el temporizador' : '3.er ACK duplicado', ancho = txt.length * 5.6 + 8;
      const der = xc(q.t) + 6 + ancho < W - mr, x = der ? xc(q.t) + 6 : xc(q.t) - 6;
      const x0 = der ? x : x - ancho, fila = ocupado.findIndex((fin) => x0 > fin);
      o.push(`<line class="g-ev" x1="${xc(q.t)}" x2="${xc(q.t)}" y1="${mt}" y2="${yv(0)}" />`);
      o.push(`<circle class="g-pto" cx="${xc(q.t)}" cy="${yv(q.vc)}" r="5" />`);
      if (fila < 0) continue;
      o.push(`<text class="g-err" x="${x}" y="${mt - 8 - fila * 13}" text-anchor="${der ? 'start' : 'end'}">${txt}</text>`);
      ocupado[fila] = x0 + ancho;
    }
    // etiquetas directas al final de las líneas
    const u = pts[pts.length - 1];
    let yV = yv(u.vc) - 8, yU = yv(u.um) + 4;
    if (Math.abs(yV - yU) < 14) { if (u.vc >= u.um) { yV = yv(u.vc) - 10; yU = yv(u.um) + 14; } else { yV = yv(u.vc) + 14; yU = yv(u.um) - 6; } }
    o.push(`<text class="g-dir" x="${W - mr + 8}" y="${yV}">VC</text><text class="g-dir" x="${W - mr + 8}" y="${yU}">umbral</text>`);
    for (const q of pts) o.push(`<rect class="g-hit" x="${xi(q.t)}" y="${mt}" width="${bw}" height="${ph}"><title>Tic ${q.t}: VC ${q.vt}, umbral ${dec(q.um)}, modo ${q.modo}, ${dec(q.vuelo)} en vuelo</title></rect>`);
    o.push('</svg>');
    const esA = cfg.rol === 'A';
    return `<section class="panel diagrama grafica">
      <h3>${esA ? 'Tu ventana de congestión' : 'La ventana de congestión de A'}</h3>
      <p class="ayuda">VC y umbral valen lo que A sabía al decidir en cada tic, ya con lo que le llegó. A solo envía datos nuevos mientras los segmentos en vuelo (columnas) sean menos que ⌊VC⌋.</p>
      <div class="tabla-scroll">${o.join('')}</div>
      <div class="leyenda">
        <span><i style="background:var(--a)"></i>VentCongestion (VC)</span>
        <span><i style="border-top:2px dashed var(--ink2);height:0"></i>umbralAL</span>
        <span><i style="background:var(--muted);opacity:.4;height:8px;width:8px"></i>Segmentos en vuelo</span>
        <span><i class="sw" style="background:var(--soft);height:10px;width:10px"></i>AL, arranque lento</span>
        <span><i class="sw" style="background:var(--a-soft);height:10px;width:10px"></i>EC, evitación de la congestión</span>
        <span><i class="sw" style="background:var(--warn-soft);height:10px;width:10px"></i>RR, recuperación rápida</span>
      </div>
      <details class="def"><summary>Ver los valores como tabla</summary>
        <div class="tabla-scroll tabla-vc"><table><thead><tr><th>Tic</th><th>VC</th><th>Umbral</th><th>Modo</th><th>En vuelo (MSS)</th></tr></thead>
        <tbody>${pts.map((q) => `<tr><td class="num">${q.t}</td><td class="num">${q.vt}</td><td class="num">${dec(q.um)}</td><td class="num">${q.modo}</td><td class="num">${dec(q.vuelo)}</td></tr>`).join('')}</tbody></table></div>
      </details>
    </section>`;
  }

  function diagramaSVG() {
    const p = partida, ultimoSeg = p.registro.reduce((m, s) => Math.max(m, s.tic), 0);
    const T = Math.max(ultimoSeg + 1, p.historia.length ? p.historia[p.historia.length - 1].tic : 1);
    const cc = !!p.esc.cc;   // con congestión, más ancho (VC y modo a la izquierda de A) y filas algo más altas
    const W = cc ? 760 : 640, top = 46, fila = cc ? 40 : 34, H = top + T * fila + 12;
    const xT = 14, xA = cc ? 316 : 196, xB = cc ? 572 : 452, xC = xB + 24, cel = 30;
    const inicial = cc ? (() => { const e = CC.crear(p.esc.cc); return { vcTexto: CC.texto(e), umbral: e.umbral, modo: e.modo }; })() : null;
    let previoA = inicial;
    const bufer = p.par.bufer, casillas = bufer <= 256 ? bufer / P.MSS : 0;   // búfer grande: texto «sin leer / búfer» en lugar de casillas
    const y = (t) => top + (t - 1) * fila;
    const o = [];
    o.push(`<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Diagrama de secuencia de la partida"${cc ? ' style="min-width:620px"' : ''}>`);
    o.push(`<text class="txt cab" x="${xA}" y="20" text-anchor="middle">A</text><text class="txt cab" x="${xB}" y="20" text-anchor="middle">B</text>`);
    o.push(`<text class="txt tenue" x="${xA - 14}" y="36" text-anchor="end">A sabe: en vuelo / W</text>`);
    if (cc) o.push(`<text class="txt tenue" x="62" y="36">VC · modo</text>`);
    o.push(`<text class="txt tenue" x="${xC}" y="36">${casillas ? `búfer de B (${casillas} × ${P.MSS} B)` : 'sin leer / búfer de B'}</text>`);
    for (let t = 1; t <= T; t++) {
      o.push(`<line class="guia" x1="${xT + 30}" x2="${xA}" y1="${y(t)}" y2="${y(t)}" />`);
      o.push(`<text class="txt tenue" x="${xT}" y="${y(t) + 4}">t${t}</text>`);
      const x = p.historia.find((hh) => hh.tic === t);
      if (x && x.humano && !x.humano.evaluacion.ok) o.push(`<text class="lbl-err" x="${xT + 26}" y="${y(t) + 4}" style="font-size:12px">✗</text>`);
      if (x) {
        const a = x.foto.A, b = x.foto.B;
        o.push(`<text class="txt${cc ? ' halo' : ''}" x="${xA - 14}" y="${y(t) + 4}" text-anchor="end">${a.enVuelo} / ${a.ventRecepcion}</text>`);
        if (cc) {
          const txt = `VC ${a.vcTexto} · ${a.modo}`, cambia = a.vcTexto !== previoA.vcTexto || a.umbral !== previoA.umbral || a.modo !== previoA.modo;
          if (cambia) o.push(`<rect class="cambia" x="57" y="${y(t) - 9}" width="${Math.ceil(txt.length * 6.7 + 10)}" height="18" rx="4" />`);
          o.push(`<text class="txt halo${cambia ? ' cambia-t' : ''}" x="62" y="${y(t) + 4}">${txt}</text>`);
          previoA = a;
        }
        // Cada casilla es un hueco de 64 B del búfer, a partir del primer octeto sin leer.
        const base = b.ultimoByteLeido + 1;
        if (!casillas) o.push(`<text class="txt" x="${xC}" y="${y(t) + 4}">${b.sinLeer} / ${bufer}</text>`);
        for (let k = 0; k < casillas; k++) {
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
      const ev = x.eventos.A.find((e) => e.tipo === 'vence') || x.eventos.A.find((e) => e.tipo === 'rapida');
      if (!ev) continue;
      const d = ev.cc && ev.cc.despues, flecha = d ? ` → umbral ${dec(d.umbral)}, VC ${d.vcTexto}, ${d.modo}` : '';
      const nombre = ev.tipo === 'vence' ? (d ? 'vence' : 'vence el temporizador') : '3.er ACK dup.';
      o.push(`<text class="lbl-err" x="${xA - 14}" y="${y(x.tic) - 8}" text-anchor="end">${nombre}${flecha}</text>`);
    }
    if (p.fin.motivo === 'completo') {
      const tf = p.fin.tic + 1;
      if (tf <= T) o.push(`<text class="txt cab" x="${xA + 8}" y="${y(tf) + 4}">${p.B.rec >= p.par.fin - 1 ? 'A sabe que ha llegado todo' : 'A cree que ha llegado todo'}</text>`);
    }
    o.push('</svg>');
    return o.join('');
  }

  inicio();
})();

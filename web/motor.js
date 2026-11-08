/* TCPGame: motor del juego (control de flujo y pérdidas, sin segmento de sondeo).
 *
 * Modelo de la web de ejercicios (Practica_Web/docs/22 §2, ModeloTcp) y del
 * Wooclap de GG33: un segmento por tic y lado; sale al comienzo del tic t,
 * llega a mitad del tic t y el receptor lo tiene en cuenta en el tic t + 1
 * (en el juego: lo ve al empezar el tic t + 1).
 *
 * El cliente A envía 384 B (1024–1407) en segmentos de 64 B; el servidor B
 * tiene un búfer de 256 B y su aplicación lee cada segmento L tics después
 * de que le llegue en orden.
 *
 * Receptor (CR3–CR6, como ModeloTcp): ACK retardado un tic si llega un
 * segmento en orden sin otro pendiente (CR3) y acumulativo si llega otro
 * (CR4); ACK duplicado inmediato si llega fuera de orden (CR5), que se
 * guarda; ACK inmediato al rellenar el hueco (CR6) y al recibir un
 * duplicado. W = 256 − (UltimoByteRecibido − UltimoByteLeido), con
 * UltimoByteRecibido = último octeto recibido EN ORDEN: lo guardado fuera
 * de orden no reduce la W (el borde derecho no retrocede). Actualización de
 * ventana cuando había anunciado W = 0 y la aplicación libera sitio (B6).
 * Se descarta lo que no cabe en el búfer (fin > UltimoByteLeido + 256).
 *
 * Emisor: no supera la ventana; temporizador único de `rto` tics (un
 * segmento enviado en t vence al comienzo de t + rto; se reinicia con cada
 * ACK que avanza, contando desde el tic en que A lo ve, y al retransmitir);
 * al vencer retransmite solo el más antiguo sin reconocer. Con la opción
 * `rapida` del escenario, además, retransmite el más antiguo al recibir el
 * tercer ACK duplicado (Kurose, fig. 3.37), sin esperar al temporizador (la
 * cuenta vuelve a 0 con un ACK que avanza y cuando vence el temporizador); la
 * web de ejercicios no la usa, porque sin control de congestión no la modela.
 *
 * Fuera de orden (opción `fuera` del escenario, como `fuera_de_orden` y
 * `retransmite` de ModeloTcp): 'almacena' (por defecto) → B guarda lo que
 * llega fuera de orden y A, al vencer, retransmite solo el más antiguo;
 * 'descarta' → B lo descarta (con su ACK duplicado igualmente) y A, al
 * vencer, retransmite toda la cola, uno por tic (como en los ejercicios
 * de la web, donde «descarta» va siempre con «cola»).
 *
 * Pérdidas (las decide el escenario y ningún jugador las ve): segmentos de
 * datos por SN e intento, y ACK por orden de envío. Nunca se pierde una
 * actualización de ventana (sin sonda, la conexión se quedaría bloqueada).
 *
 * Se usa igual en el navegador (window.MotorTCP) que en node (require).
 */
(function (raiz) {
  'use strict';

  const P = { MSS: 64, SN_A: 1024, FIN_A: 1408, SN_B: 2048, BUFER: 256, W_A: 512, MAX_TICS: 40 };
  const SIN = { datos: [], acks: [] };

  const ESCENARIOS = {
    N1: { id: 'N1', grupo: 'flujo', nombre: 'La aplicación lee al momento', L: 0, rto: 4, perdidas: SIN, ref: 7 },
    N2: { id: 'N2', grupo: 'flujo', nombre: 'La aplicación lee despacio', L: 2, rto: 4, perdidas: SIN, ref: 8 },
    N3: { id: 'N3', grupo: 'flujo', nombre: 'La aplicación se duerme', L: 8, rto: 4, perdidas: SIN, ref: 16 },
    P1: { id: 'P1', grupo: 'perdidas', nombre: 'Se pierde un segmento de datos', L: 0, rto: 4, perdidas: { datos: [{ sn: 1088, envio: 1 }], acks: [] } },
    P2: { id: 'P2', grupo: 'perdidas', nombre: 'Se pierde un ACK, pero el siguiente llega a tiempo', L: 0, rto: 5, perdidas: { datos: [], acks: [1] } },
    P3: { id: 'P3', grupo: 'perdidas', nombre: 'Se pierde un ACK y vence el temporizador', L: 0, rto: 4, perdidas: { datos: [], acks: [1] } },
    P4: { id: 'P4', grupo: 'perdidas', nombre: 'Se pierde un segmento y la aplicación lee despacio', L: 2, rto: 4, perdidas: { datos: [{ sn: 1152, envio: 1 }], acks: [] } },
    P5: { id: 'P5', grupo: 'perdidas', nombre: 'Se pierde un segmento y el temporizador es largo', L: 0, rto: 7, perdidas: { datos: [{ sn: 1088, envio: 1 }], acks: [] } },
  };

  /** Escenario con pérdidas al azar: lectura 0 o 2, una o dos pérdidas. */
  function escenarioAzar(azar) {
    const r = azar || Math.random, elegir = (xs) => xs[Math.floor(r() * xs.length)];
    const L = elegir([0, 0, 2]), n = elegir([1, 2]);
    const datos = [], acks = [];
    const sns = [1024, 1088, 1152, 1216, 1280, 1344];
    for (let i = 0; i < n; i++) {
      if (r() < 0.55) {
        const sn = elegir(sns);
        if (!datos.some((d) => d.sn === sn)) datos.push({ sn, envio: 1 });
      } else {
        const k = elegir([1, 2, 3]);
        if (!acks.includes(k)) acks.push(k);
      }
    }
    return { id: 'AZ', grupo: 'perdidas', nombre: 'Pérdidas al azar', L, rto: 4, perdidas: { datos, acks } };
  }

  const rango = (ini, datos) => `${ini}–${ini + datos - 1}`;

  class Partida {
    /** esc: id o escenario; rol: 'A', 'B' o null (los dos lados los juega el motor). */
    constructor(esc, rol) {
      this.esc = typeof esc === 'string' ? ESCENARIOS[esc] : esc;
      if (!this.esc) throw new Error('Escenario desconocido: ' + esc);
      this.rol = rol || null;
      this.tic = 0;
      this.registro = [];   // segmentos {tic, lado, sn, an, w, datos, perdido, descartado, motivo, retx}
      this.lecturas = [];   // {tic, ini, fin}: el aviso llega al comienzo de ese tic
      this.historia = [];   // un elemento por tic jugado
      this.fin = null;      // {tic, motivo}
      this.intentos = {};   // sn → veces enviado
      this.nAcks = 0;
      this.A = { sig: P.SN_A, an: P.SN_A, w: P.BUFER, vence: null, retxDebida: null, dups: 0, cola: null, colaFin: null };
      this.B = { rec: P.SN_A - 1, leido: P.SN_A - 1, porLeer: [], fuera: [], anAnunciado: P.SN_A, wAnunciada: P.BUFER,
                 pendienteDesde: null, ackDebido: null };
      this.eventos = { A: [], B: [] };
    }

    wB() { return P.BUFER - (this.B.rec - this.B.leido); }

    /** Estado real de cada lado, tal como queda tras los eventos del tic. */
    foto() {
      const A = this.A, B = this.B;
      return {
        A: { ultimoByteEnviado: A.sig - 1, ultimoByteReconocido: A.an - 1, ventRecepcion: A.w,
             enVuelo: A.sig - A.an, vence: A.an < A.sig ? A.vence : null, dups: A.dups,
             cola: A.cola !== null && A.cola < A.colaFin ? A.cola : null },
        B: { ultimoByteRecibido: B.rec, ultimoByteLeido: B.leido, sinLeer: B.rec - B.leido, ventRecepcion: this.wB(),
             fuera: B.fuera.map((f) => ({ ...f })), pendienteDesde: B.pendienteDesde, wAnunciada: B.wAnunciada },
      };
    }

    recibirDatos(s, t, evB) {
      const B = this.B, fin = s.sn + s.datos - 1;
      const yaFuera = B.fuera.some((f) => f.ini === s.sn);
      if (fin <= B.rec || yaFuera) {
        s.descartado = true; s.motivo = 'duplicado';
        B.ackDebido = 'ack_repetido';
        evB.push({ tipo: 'descarte', seg: s, motivo: 'duplicado' });
        return;
      }
      if (fin > B.leido + P.BUFER) {
        s.descartado = true; s.motivo = 'no_cabe';
        B.ackDebido = B.ackDebido || 'ack_no_cabe';
        evB.push({ tipo: 'descarte', seg: s, motivo: 'no_cabe', libre: B.leido + P.BUFER - B.rec });
        return;
      }
      if (s.sn > B.rec + 1 && this.esc.fuera === 'descarta') {
        s.descartado = true; s.motivo = 'fuera_de_orden';
        B.ackDebido = 'ack_duplicado';
        evB.push({ tipo: 'descarte', seg: s, motivo: 'fuera_de_orden', espera: B.rec + 1 });
        return;
      }
      if (s.sn > B.rec + 1) {
        B.fuera.push({ ini: s.sn, fin });
        B.fuera.sort((x, y) => x.ini - y.ini);
        B.ackDebido = 'ack_duplicado';
        evB.push({ tipo: 'fuera_de_orden', seg: s, espera: B.rec + 1 });
        return;
      }
      // en orden
      const habiaHueco = B.fuera.length > 0;
      B.rec = fin;
      B.porLeer.push({ ini: s.sn, fin, tic: t + this.esc.L });
      const unidos = [];
      while (B.fuera.length && B.fuera[0].ini <= B.rec + 1) {
        const f = B.fuera.shift();
        if (f.fin > B.rec) {
          B.porLeer.push({ ini: f.ini, fin: f.fin, tic: t + this.esc.L });
          B.rec = f.fin;
          unidos.push(f);
        }
      }
      evB.push({ tipo: 'llegada', seg: s, unidos, hueco: habiaHueco });
      if (habiaHueco) { B.ackDebido = 'ack_hueco'; B.pendienteDesde = null; }
      else if (B.pendienteDesde === null && !B.ackDebido) B.pendienteDesde = t;
    }

    /** Avanza al tic siguiente y entrega los eventos. Devuelve false si la partida ha acabado. */
    empezarTic() {
      if (this.fin) return false;
      this.tic++;
      const t = this.tic, evA = [], evB = [], A = this.A, B = this.B;
      A.retxDebida = null;
      for (const s of this.registro.filter((x) => x.tic === t - 1 && !x.perdido)) {
        if (s.lado === 'A') {
          this.recibirDatos(s, t, evB);
        } else if (s.an > A.an && s.an <= A.sig) {
          A.an = s.an; A.w = s.w; A.dups = 0;
          if (A.cola !== null) A.cola = Math.max(A.cola, A.an);
          A.vence = A.an < A.sig ? t + this.esc.rto : null;
          evA.push({ tipo: 'ack', seg: s });
        } else if (s.an === A.an) {
          const dup = A.an < A.sig;
          A.w = s.w;
          if (dup) A.dups++;
          evA.push({ tipo: 'ack', seg: s, duplicado: dup, n: dup ? A.dups : 0 });
          if (dup && A.dups === 3 && this.esc.rapida) {
            evA.push({ tipo: 'rapida', desde: A.an });
            A.retxDebida = 'retx_rapida';
          }
        } else {
          evA.push({ tipo: 'ack_viejo', seg: s });
        }
        if (A.an >= P.FIN_A && !this.fin) this.fin = { tic: s.tic, motivo: 'completo' };
      }
      // Un ACK duplicado/inmediato cubre el retardado que hubiera pendiente.
      if (B.ackDebido) B.pendienteDesde = null;
      while (B.porLeer.length && B.porLeer[0].tic <= t) {
        const r = B.porLeer.shift();
        B.leido = r.fin;
        this.lecturas.push({ tic: t, ini: r.ini, fin: r.fin });
        evB.push({ tipo: 'lectura', ini: r.ini, fin: r.fin });
      }
      if (!this.fin && A.vence !== null && A.vence <= t && A.an < A.sig) {
        evA.push({ tipo: 'vence', desde: A.an });
        A.retxDebida = 'retx_temporizador';
        if (this.esc.fuera === 'descarta') { A.cola = A.an + P.MSS; A.colaFin = A.sig; }   // después del más antiguo, el resto de lo enviado
        A.dups = 0;   // ya se retransmite: los duplicados que lleguen después se cuentan de nuevo
        A.vence = t + this.esc.rto;   // se reinicia al vencer (y otra vez si se retransmite)
      }
      if (this.fin) {
        this.eventos = { A: evA, B: evB };
        this.historia.push({ tic: t, eventos: this.eventos, foto: this.foto(), final: true });
        return false;
      }
      if (t > P.MAX_TICS) {
        this.fin = { tic: t - 1, motivo: 'tope' };
        return false;
      }
      this.eventos = { A: evA, B: evB };
      this.historia.push({ tic: t, eventos: this.eventos, foto: this.foto() });
      return true;
    }

    /** Lo que haría TCP en este lado con su estado local. {accion, causa, info} */
    decisionTCP(lado) {
      const t = this.tic;
      if (lado === 'A') {
        const A = this.A, borde = A.an + A.w, vuelo = A.sig - A.an;
        const cola = A.cola !== null && A.cola < A.colaFin ? A.cola : null;
        const info = { vuelo, w: A.w, sig: A.sig, an: A.an, borde, dups: A.dups, rapida: !!this.esc.rapida, cola };
        if (A.retxDebida) return { accion: { sn: A.an, an: P.SN_B, w: P.W_A, datos: P.MSS }, causa: A.retxDebida, info };
        if (cola !== null) return { accion: { sn: cola, an: P.SN_B, w: P.W_A, datos: P.MSS }, causa: 'retx_cola', info };
        if (A.sig >= P.FIN_A) return { accion: null, causa: 'todo_enviado', info };
        if (A.sig + P.MSS <= borde) return { accion: { sn: A.sig, an: P.SN_B, w: P.W_A, datos: P.MSS }, causa: 'cabe', info };
        return { accion: null, causa: A.w === 0 ? 'ventana_cero' : 'ventana_llena', info };
      }
      const B = this.B, an = B.rec + 1, w = this.wB();
      const info = { an, w, rec: B.rec, leido: B.leido, desde: B.pendienteDesde, wAnunciada: B.wAnunciada, fuera: B.fuera.map((f) => ({ ...f })),
                     descarta: this.esc.fuera === 'descarta' };
      const ack = { sn: P.SN_B, an, w, datos: 0 };
      if (B.ackDebido) return { accion: ack, causa: B.ackDebido, info };
      if (B.pendienteDesde !== null && B.pendienteDesde < t) {
        const nuevos = this.registro.filter((s) => s.lado === 'A' && !s.perdido && !s.descartado && s.tic < t && s.sn >= B.anAnunciado && s.sn <= B.rec).length;
        return { accion: ack, causa: nuevos > 1 ? 'ack_acumulativo' : 'ack_retardado', info: { ...info, nuevos } };
      }
      if (B.wAnunciada === 0 && w > 0) return { accion: ack, causa: 'actualizacion', info };
      if (B.pendienteDesde === t) return { accion: null, causa: 'espera_cr3', info };
      return { accion: null, causa: 'nada', info };
    }

    /** Cierra el tic con la tarjeta del jugador humano (o null si no juega nadie). */
    cerrarTic(accionHumano, hojaHumano) {
      const t = this.tic, h = this.historia[this.historia.length - 1], A = this.A, B = this.B;
      const decA = this.decisionTCP('A'), decB = this.decisionTCP('B');
      const accA = this.rol === 'A' ? accionHumano : decA.accion;
      const accB = this.rol === 'B' ? accionHumano : decB.accion;
      if (this.rol) {
        const esperada = this.rol === 'A' ? decA : decB;
        h.humano = { accion: accionHumano, hoja: hojaHumano || null, esperada,
                     evaluacion: evaluar(this.rol, accionHumano, hojaHumano, esperada, h.foto[this.rol]) };
      }
      h.decisiones = { A: decA, B: decB };
      if (accA) {
        const n = (this.intentos[accA.sn] = (this.intentos[accA.sn] || 0) + 1);
        const perdido = this.esc.perdidas.datos.some((d) => d.sn === accA.sn && d.envio === n);
        const s = { tic: t, lado: 'A', sn: accA.sn, an: P.SN_B, w: P.W_A, datos: P.MSS, perdido, retx: accA.sn < A.sig };
        this.registro.push(s);
        if (s.sn === A.sig) {
          if (A.vence === null || A.an === A.sig) A.vence = t + this.esc.rto;
          A.sig += s.datos;
        } else if (s.sn === A.an && s.sn < A.sig) {
          A.vence = t + this.esc.rto;   // retransmisión del más antiguo: se reinicia
        } else if (A.cola !== null && s.sn === A.cola && s.sn < A.colaFin) {
          A.cola += P.MSS;               // retransmisión de la cola: no toca el temporizador
        }
      }
      if (accB) {
        this.nAcks++;
        const perdido = this.esc.perdidas.acks.includes(this.nAcks) && B.wAnunciada !== 0;
        this.registro.push({ tic: t, lado: 'B', sn: P.SN_B, an: accB.an, w: accB.w, datos: 0, perdido });
        B.anAnunciado = accB.an;
        B.wAnunciada = accB.w;
        if (accB.an > B.rec) B.pendienteDesde = null;
      }
      // Los ACK inmediatos solo se exigen en su tic: si no se envían, cuentan como un error, no como uno por tic.
      B.ackDebido = null;
      h.enviados = { A: accA, B: accB };
      return h.humano ? h.humano.evaluacion : null;
    }

    /** Juega la partida entera con el motor en los dos lados. */
    static simular(esc) {
      const p = new Partida(esc, null);
      while (p.empezarTic()) p.cerrarTic(null);
      return p;
    }
  }

  /* ---------- Evaluación de un tic ---------- */

  const CAMPOS = {
    A: [['ultimoByteEnviado', 'UltimoByteEnviado'], ['ultimoByteReconocido', 'UltimoByteReconocido'], ['ventRecepcion', 'VentRecepcion']],
    B: [['ultimoByteRecibido', 'UltimoByteRecibido'], ['ultimoByteLeido', 'UltimoByteLeido'], ['ventRecepcion', 'VentRecepcion']],
  };

  function evaluar(rol, acc, hoja, esp, foto) {
    const campos = [];
    if (hoja) {
      for (const [k, nombre] of CAMPOS[rol]) {
        const tuyo = hoja[k] === '' || hoja[k] === undefined || hoja[k] === null ? null : Number(hoja[k]);
        campos.push({ campo: k, nombre, tuyo, correcto: foto[k], ok: tuyo === foto[k] });
      }
    }
    const d = rol === 'A' ? evaluarA(acc, esp) : evaluarB(acc, esp);
    return { campos, decision: d, ok: d.ok && campos.every((c) => c.ok) };
  }

  function evaluarA(acc, esp) {
    const i = esp.info, e = esp.accion;
    const cuenta = `En vuelo: ${i.sig - 1} − ${i.an - 1} = ${i.vuelo} B; ${i.vuelo} + 64 = ${i.vuelo + 64} ${i.vuelo + 64 <= i.w ? '≤' : '>'} VentRecepcion = ${i.w}.`;
    if (esp.causa === 'retx_temporizador') {
      if (acc && acc.sn === e.sn) return { ok: true, codigo: 'OK', texto: `Bien: venció el temporizador y retransmites el más antiguo sin reconocer (SN = ${e.sn}).` };
      return { ok: false, codigo: 'E_SIN_RETX', texto: `Venció el temporizador: había que retransmitir el segmento más antiguo sin reconocer, SN = ${e.sn} (el AN del último ACK)${acc ? `; enviaste SN = ${acc.sn}` : ''}.` };
    }
    if (esp.causa === 'retx_rapida') {
      if (acc && acc.sn === e.sn) return { ok: true, codigo: 'OK', texto: `Bien: es el tercer ACK duplicado con AN = ${e.sn}. Retransmisión rápida del ${e.sn}, sin esperar a que venza el temporizador.` };
      return { ok: false, codigo: 'E_SIN_RETX_RAPIDA', texto: `Te han llegado tres ACK duplicados con AN = ${e.sn}: B te está diciendo que le falta ese segmento. Tocaba la retransmisión rápida del SN = ${e.sn}${acc ? `; enviaste SN = ${acc.sn}` : ''}.` };
    }
    if (esp.causa === 'retx_cola') {
      if (acc && acc.sn === e.sn) return { ok: true, codigo: 'OK', texto: `Bien: después de vencer el temporizador reenvías toda la cola, uno por tic. Toca el ${e.sn} (lo enviado sin reconocer llega hasta el ${i.sig - 1}).` };
      return { ok: false, codigo: 'E_SIN_RETX_COLA', texto: `Venció el temporizador y estás reenviando la cola, uno por tic: tocaba SN = ${e.sn}, el siguiente sin reconocer después del que ya reenviaste${acc ? `; enviaste SN = ${acc.sn}` : ''}. B descarta lo que llega fuera de orden, así que todo lo que enviaste detrás del hueco hay que volver a enviarlo.` };
    }
    if (!e && !acc) {
      const txt = esp.causa === 'todo_enviado'
        ? (i.vuelo > 0 ? 'Ya habías enviado todo el fichero: esperas los ACK (o a que venza el temporizador).' : 'Ya habías enviado todo el fichero: solo queda esperar el ACK final.')
        : esp.causa === 'ventana_cero' ? 'B anunció W = 0: hay que esperar a que avise de que tiene sitio.'
        : 'Bien: no cabía otro segmento. ' + cuenta;
      return { ok: true, codigo: 'OK', texto: txt };
    }
    if (e && !acc) return { ok: false, codigo: 'E_NO_ENVIA', texto: `Cabía otro segmento y no lo enviaste. ${cuenta} Tocaba SN = ${e.sn}.` };
    if (acc.sn < i.sig && acc.sn >= i.an) {
      const dupTxt = !i.dups ? '' : i.rapida
        ? (i.dups < 3 ? ` Llevas ${i.dups} ACK duplicado${i.dups > 1 ? 's' : ''}: la retransmisión rápida espera al tercero.` : ' La retransmisión rápida ya se hizo al llegar el tercer ACK duplicado; los siguientes no hacen reenviar otra vez.')
        : ' En esta partida no hay retransmisión rápida: los ACK duplicados no hacen reenviar.';
      return { ok: false, codigo: 'E_RETX_ANTES', texto: `Reenvías el ${acc.sn} sin que haya vencido el temporizador. Sin ACK no sabes si se ha perdido o si va de camino: se espera al temporizador.${dupTxt}` };
    }
    if (acc.sn < i.an) return { ok: false, codigo: 'E_SN', texto: `El ${acc.sn} ya estaba reconocido (el último AN fue ${i.an}).` };
    if (!e) {
      if (esp.causa === 'todo_enviado') return { ok: false, codigo: 'E_NO_QUEDAN', texto: 'Ya no quedaban datos nuevos que enviar (el fichero acaba en el 1407).' };
      return { ok: false, codigo: 'E_VENTANA', texto: `Enviaste fuera de la ventana. ${cuenta} B no te había asegurado sitio para ese segmento: puede que quepa o puede que no, pero tú no puedes saberlo.` };
    }
    if (acc.sn !== e.sn) return { ok: false, codigo: 'E_SN', texto: `El SN tenía que ser ${e.sn} (el siguiente octeto que no habías enviado); pusiste ${acc.sn}.` };
    return { ok: true, codigo: 'OK', texto: 'Bien: cabía. ' + cuenta };
  }

  const huecoTxt = (i) => (i.fuera && i.fuera.length ? ` Tienes guardado fuera de orden ${i.fuera.map((f) => `${f.ini}–${f.fin}`).join(', ')}.` : '');

  function evaluarB(acc, esp) {
    const i = esp.info, e = esp.accion;
    const cuentaW = `W = 256 − (${i.rec} − ${i.leido}) = ${i.w}.`;
    const por = {
      ack_retardado: `Tenías un ACK pendiente desde el tic ${i.desde} y no ha llegado otro en orden: ya no se espera más (CR3).`,
      ack_acumulativo: `Tenías un ACK pendiente desde el tic ${i.desde} y ha llegado otro: un ACK reconoce los dos (CR4).`,
      actualizacion: 'Tu último ACK anunció W = 0 y tu aplicación ha liberado sitio: hay que avisar a A (actualización de ventana).',
      ack_duplicado: i.descarta
        ? `Ha llegado un segmento fuera de orden: lo descartas y respondes enseguida con un ACK duplicado que pide el ${i.an} (CR5).`
        : `Ha llegado un segmento fuera de orden: hay un hueco y se responde enseguida con un ACK duplicado que pide el ${i.an} (CR5).${huecoTxt(i)}`,
      ack_hueco: 'El segmento que ha llegado rellena el hueco: ACK inmediato (CR6), que reconoce también lo que tenías guardado fuera de orden.',
      ack_repetido: 'Te ha llegado un segmento que ya tenías (A lo ha retransmitido): se responde enseguida con el AN que esperas, por si A no recibió tu ACK.',
      ack_no_cabe: 'Acabas de descartar un segmento que no cabía en el búfer: se responde enseguida con el AN y la W que tienes.',
    };
    if (!e && !acc) {
      return { ok: true, codigo: 'OK', texto: esp.causa === 'espera_cr3' ? 'Bien: segmento en orden sin otro pendiente; esperas un tic por si llega otro (CR3).' : 'Bien: no había nada que reconocer.' };
    }
    if (e && !acc) {
      const cod = { actualizacion: 'E_SIN_ACTUALIZACION', ack_duplicado: 'E_SIN_ACK_DUPLICADO', ack_hueco: 'E_SIN_ACK_HUECO', ack_repetido: 'E_SIN_ACK_INMEDIATO', ack_no_cabe: 'E_SIN_ACK_INMEDIATO' }[esp.causa] || 'E_ACK_FALTA';
      return { ok: false, codigo: cod, texto: `${por[esp.causa]} Tocaba AN = ${e.an}, W = ${e.w}.` };
    }
    if (!e && acc) {
      if (esp.causa === 'espera_cr3') return { ok: false, codigo: 'E_ACK_NO_RETARDADO', texto: 'Segmento en orden sin otro ACK pendiente: se espera un tic por si llega otro (CR3).' };
      return { ok: false, codigo: 'E_ACK_SOBRA', texto: 'No había nada nuevo que reconocer ni ventana que actualizar.' };
    }
    const errores = [];
    if (acc.an !== e.an) errores.push(`el AN es el siguiente octeto que esperas en orden: ${i.rec} + 1 = ${e.an} (pusiste ${acc.an})`);
    if (acc.w !== e.w) {
      let pista = '';
      if (acc.w === 256) pista = ' No descuentas lo que tienes sin leer.';
      else if (i.fuera && i.fuera.length) pista = ' Lo guardado fuera de orden no se descuenta: el borde derecho de la ventana no retrocede.';
      else if (acc.w === 256 - (i.rec - (P.SN_A - 1))) pista = ' Descuentas también lo que tu aplicación ya ha leído.';
      errores.push(`${cuentaW}${pista} (pusiste ${acc.w})`);
    }
    if (errores.length) return { ok: false, codigo: acc.an !== e.an ? 'E_AN' : 'E_W', texto: 'ACK en su tic, pero ' + errores.join('; ') + '.' };
    return { ok: true, codigo: 'OK', texto: `Bien. ${por[esp.causa]} ${cuentaW}` };
  }

  const MotorTCP = { P, ESCENARIOS, Partida, rango, escenarioAzar };
  if (typeof module !== 'undefined' && module.exports) module.exports = MotorTCP;
  else raiz.MotorTCP = MotorTCP;
})(typeof window !== 'undefined' ? window : globalThis);

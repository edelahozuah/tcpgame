// node tests/pruebas_motor.js  — comprueba el motor contra las soluciones de referencia y algunos errores típicos.
'use strict';
const path = require('path');
const fs = require('fs');
const { Partida, ESCENARIOS, P } = require('../web/motor.js');

let fallos = 0;
const ok = (cond, msg) => { if (!cond) { fallos++; console.log('  FALLO:', msg); } };

// 1. Motor contra motor = soluciones de referencia de los ejercicios
const trazas = JSON.parse(fs.readFileSync(path.join(__dirname, 'trazas_referencia.json'), 'utf8')).apartados;
const mapa = { N1: 'inmediata', N2: 'lenta', N3: 'cero' };
for (const [id, ap] of Object.entries(mapa)) {
  const p = Partida.simular(id);
  const nuestro = p.registro.map((s) => [s.tic, s.lado === 'A' ? 'cliente' : 'servidor', s.sn, s.lado === 'A' ? 2048 : s.an, s.lado === 'B' ? s.w : 512, s.datos].join(' '));
  const ref = trazas[ap].segmentos.map((s) => [s.tic, s.lado, s.sn, s.an, s.w, s.datos].join(' '));
  console.log(`${id} (${ap}): ${nuestro.length} segmentos, fin en el tic ${p.fin.tic} (referencia ${ESCENARIOS[id].ref})`);
  ok(JSON.stringify(nuestro) === JSON.stringify(ref), `${id} no coincide con la traza\n    nuestro: ${nuestro.join(' | ')}\n    ref:     ${ref.join(' | ')}`);
  ok(p.fin.tic === ESCENARIOS[id].ref && p.fin.motivo === 'completo', `${id}: fin ${JSON.stringify(p.fin)}`);
}

// 2. Jugador que imita al motor: todo correcto
for (const rol of ['A', 'B']) {
  for (const id0 of Object.keys(ESCENARIOS)) for (const rapida of [false, true]) for (const fuera of ['almacena', 'descarta']) {
    const id = { ...ESCENARIOS[id0], rapida, fuera };
    const p = new Partida(id, rol);
    while (p.empezarTic()) {
      const f = p.historia[p.historia.length - 1].foto[rol];
      const ev = p.cerrarTic(p.decisionTCP(rol).accion, f);
      ok(ev.ok, `${rol}/${id} tic ${p.tic}: ${JSON.stringify(ev)}`);
    }
    ok(p.fin.tic === Partida.simular(id).fin.tic, `${rol}/${id0}${rapida ? '+rápida' : ''} /${fuera} imitando al motor acaba en ${p.fin.tic}`);
  }
}

// 3. Emisor que envía en todos los tics, sin mirar la ventana (N3): desborda, se recupera por temporizador
{
  const p = new Partida('N3', 'A');
  let sig = 1024, errores = [];
  while (p.empezarTic()) {
    const ev = p.historia[p.historia.length - 1].eventos.A;
    if (ev.some((e) => e.tipo === 'vence')) sig = ev.find((e) => e.tipo === 'vence').desde;
    const acc = sig < 1408 ? { sn: sig, datos: 64 } : null;
    if (acc) sig += 64;
    const r = p.cerrarTic(acc, null);
    if (!r.decision.ok) errores.push(`${p.tic}:${r.decision.codigo}`);
  }
  const desc = p.registro.filter((s) => s.descartado).length;
  console.log(`Emisor ansioso en N3: ${desc} descartados, errores ${errores.join(' ')}, fin ${JSON.stringify(p.fin)}`);
  ok(desc > 0 && errores.includes('5:E_VENTANA'), 'el emisor ansioso debería desbordar el búfer');
}

// 4. Receptor que responde siempre al momento y con W = 256 (N2)
{
  const p = new Partida('N2', 'B');
  const cods = [];
  while (p.empezarTic()) {
    const llegó = p.historia[p.historia.length - 1].eventos.B.some((e) => e.tipo !== 'lectura');
    const r = p.cerrarTic(llegó ? { sn: 2048, an: p.B.rec + 1, w: 256, datos: 0 } : null, null);
    if (!r.decision.ok) cods.push(`${p.tic}:${r.decision.codigo}`);
  }
  console.log(`Receptor impaciente en N2: ${cods.join(' ')} · fin ${JSON.stringify(p.fin)}`);
  ok(cods.some((c) => c.endsWith('E_ACK_NO_RETARDADO')), 'falta E_ACK_NO_RETARDADO');
}

// 5. Receptor que nunca envía la actualización de ventana (N3): bloqueo
{
  const p = new Partida('N3', 'B');
  while (p.empezarTic()) {
    const d = p.decisionTCP('B');
    p.cerrarTic(d.causa === 'actualizacion' ? null : d.accion, null);
  }
  console.log(`Receptor sin actualización en N3: fin ${JSON.stringify(p.fin)}`);
  ok(p.fin.motivo === 'tope', 'debería bloquearse');
}

// 6. Receptor que no responde a los descartes: un error por descarte, no uno por tic
{
  const p = new Partida('N3', 'B');
  const cods = [];
  while (p.empezarTic()) {
    const llegó = p.historia[p.historia.length - 1].eventos.B.some((e) => e.tipo === 'llegada');
    const r = p.cerrarTic(llegó ? { sn: 2048, an: p.B.rec + 1, w: 256, datos: 0 } : null, null);
    if (!r.decision.ok) cods.push(`${p.tic}:${r.decision.codigo}`);
  }
  const inm = cods.filter((c) => c.endsWith('E_SIN_ACK_INMEDIATO')).length;
  console.log(`Receptor que ignora descartes en N3: ${cods.join(' ')}`);
  ok(inm === p.registro.filter((s) => s.descartado).length, 'un E_SIN_ACK_INMEDIATO por descarte');
}

// 7. Escenarios con pérdidas: lo que tiene que pasar en cada uno
{
  const resumen = (id) => {
    const p = Partida.simular(id);
    const causa = (s) => p.historia.find((h) => h.tic === s.tic).decisiones[s.lado].causa;
    return { p, segs: p.registro.map((s) => `${s.tic}${s.lado}${s.lado === 'A' ? s.sn : s.an + '/' + s.w}${s.perdido ? 'X' : ''}:${causa(s)}`) };
  };
  const esperado = {
    P1: { fin: 12, tiene: ['2A1088X:cabe', '4B1088/256:ack_duplicado', '8A1088:retx_temporizador', '9B1344/256:ack_hueco'] },
    P2: { fin: 8, tiene: ['3B1152/256X:ack_acumulativo', '5B1280/256:ack_acumulativo'], noTiene: 'retx_temporizador' },
    P3: { fin: 8, tiene: ['3B1152/256X:ack_acumulativo', '5A1024:retx_temporizador', '6B1280/256:ack_repetido'] },
    P4: { fin: 9, tiene: ['3A1152X:cabe', '5B1152/256:ack_duplicado', '8A1152:retx_temporizador', '9B1408/0:ack_hueco'] },
  };
  for (const [id, e] of Object.entries(esperado)) {
    const { p, segs } = resumen(id);
    console.log(`${id}: fin ${p.fin.tic} · ${segs.join(' ')}`);
    ok(p.fin.tic === e.fin, `${id}: fin ${p.fin.tic}, esperado ${e.fin}`);
    for (const x of e.tiene) ok(segs.includes(x), `${id}: falta ${x}`);
    if (e.noTiene) ok(!segs.some((x) => x.endsWith(e.noTiene)), `${id}: sobra ${e.noTiene}`);
  }
  // Emisor impaciente en P1: reenvía el 1088 sin esperar al temporizador
  const p = new Partida('P1', 'A');
  const cods = [];
  while (p.empezarTic()) {
    const d = p.decisionTCP('A');
    const acc = p.tic === 6 ? { sn: 1088, datos: 64 } : d.accion;
    const r = p.cerrarTic(acc, null);
    if (!r.decision.ok) cods.push(`${p.tic}:${r.decision.codigo}`);
  }
  console.log(`Emisor impaciente en P1: ${cods.join(' ')} · fin ${p.fin.tic}`);
  ok(cods[0] === '6:E_RETX_ANTES', 'falta E_RETX_ANTES');
  // Receptor que no envía el ACK duplicado en P1
  const q = new Partida('P1', 'B');
  const cq = [];
  while (q.empezarTic()) {
    const d = q.decisionTCP('B');
    const r = q.cerrarTic(d.causa === 'ack_duplicado' ? null : d.accion, null);
    if (!r.decision.ok) cq.push(`${q.tic}:${r.decision.codigo}`);
  }
  console.log(`Receptor sin ACK duplicado en P1: ${cq.join(' ')} · fin ${q.fin.tic}`);
  ok(cq.length === 3 && cq.every((c) => c.endsWith('E_SIN_ACK_DUPLICADO')), 'tres E_SIN_ACK_DUPLICADO');
  // Pérdidas al azar: siempre terminan con el motor en los dos lados
  let semilla = 7;
  const azar = () => ((semilla = (semilla * 16807) % 2147483647) / 2147483647);
  const { escenarioAzar } = require('../web/motor.js');
  for (let i = 0; i < 300; i++) {
    const esc = escenarioAzar(azar);
    for (const rapida of [false, true]) for (const fuera of ['almacena', 'descarta']) {
      const r = Partida.simular({ ...esc, rapida, fuera });
      ok(r.fin.motivo === 'completo', `azar ${JSON.stringify(esc)} no termina`);
    }
  }
}

// 8. Retransmisión rápida
{
  const con = (id) => ({ ...ESCENARIOS[id], rapida: true });
  for (const [id, sin, rap, tic] of [['P1', 12, 11, 7], ['P5', 15, 11, 7]]) {
    const a = Partida.simular(id), b = Partida.simular(con(id));
    const retx = b.registro.find((s) => s.lado === 'A' && s.retx);
    const causa = b.historia.find((h) => h.tic === retx.tic).decisiones.A.causa;
    console.log(`${id}: sin retx. rápida acaba en ${a.fin.tic}, con ella en ${b.fin.tic} (reenvía el ${retx.sn} en el tic ${retx.tic}, ${causa})`);
    ok(a.fin.tic === sin && b.fin.tic === rap && retx.tic === tic && causa === 'retx_rapida', `${id} con retransmisión rápida`);
  }
  // En P4 vence el temporizador antes del tercer duplicado: una sola retransmisión
  const p4 = Partida.simular(con('P4'));
  ok(p4.registro.filter((s) => s.retx).length === 1, 'P4: una sola retransmisión');
  // Emisor que no hace la retransmisión rápida
  const p = new Partida(con('P5'), 'A');
  const cods = [];
  while (p.empezarTic()) {
    const d = p.decisionTCP('A');
    const r = p.cerrarTic(d.causa === 'retx_rapida' ? null : d.accion, null);
    if (!r.decision.ok) cods.push(`${p.tic}:${r.decision.codigo}`);
  }
  console.log(`Emisor sin retransmisión rápida en P5: ${cods.join(' ')} · fin ${p.fin.tic}`);
  ok(cods[0] === '7:E_SIN_RETX_RAPIDA', 'falta E_SIN_RETX_RAPIDA');
  // Emisor que reenvía al segundo duplicado
  const q = new Partida(con('P5'), 'A');
  let txt = '';
  while (q.empezarTic()) {
    const d = q.decisionTCP('A');
    const r = q.cerrarTic(q.tic === 6 ? { sn: 1088, datos: 64 } : d.accion, null);
    if (q.tic === 6) txt = r.decision.codigo + ' ' + r.decision.texto;
  }
  ok(txt.startsWith('E_RETX_ANTES') && txt.includes('espera al tercero'), 'reenvío al segundo duplicado: ' + txt);
}

// 9. B descarta lo que llega fuera de orden y A retransmite la cola (como «descarta/cola» en los ejercicios)
{
  const des = (id) => ({ ...ESCENARIOS[id], fuera: 'descarta' });
  const resumen = (esc) => {
    const p = Partida.simular(esc);
    const causa = (s) => p.historia.find((h) => h.tic === s.tic).decisiones[s.lado].causa;
    return { p, segs: p.registro.map((s) => `${s.tic}${s.lado}${s.lado === 'A' ? s.sn : s.an}${s.perdido ? 'X' : ''}${s.descartado ? 'D' : ''}:${causa(s)}`) };
  };
  const esperado = {
    P1: { fin: 14, tiene: ['3A1152D:cabe', '4B1088:ack_duplicado', '8A1088:retx_temporizador', '9A1152:retx_cola', '11A1280:retx_cola', '12A1344:cabe'] },
    P4: { fin: 12, tiene: ['4A1216D:cabe', '8A1152:retx_temporizador', '11A1344:retx_cola'] },
    P3: { fin: 8, tiene: ['5A1024D:retx_temporizador', '6A1280:cabe'] },
  };
  for (const [id, e] of Object.entries(esperado)) {
    const { p, segs } = resumen(des(id));
    console.log(`${id} descarta: fin ${p.fin.tic} · ${segs.join(' ')}`);
    ok(p.fin.tic === e.fin, `${id} descarta: fin ${p.fin.tic}, esperado ${e.fin}`);
    for (const x of e.tiene) ok(segs.includes(x), `${id} descarta: falta ${x}`);
    ok(p.B.fuera.length === 0, `${id} descarta: B no guarda nada fuera de orden`);
  }
  // Emisor que, tras vencer, retransmite solo el más antiguo y luego sigue con datos nuevos
  const p = new Partida(des('P1'), 'A');
  const cods = [];
  while (p.empezarTic()) {
    const d = p.decisionTCP('A');
    const acc = d.causa === 'retx_cola' ? (p.A.sig < P.FIN_A ? { sn: p.A.sig, datos: 64 } : null) : d.accion;
    const r = p.cerrarTic(acc, null);
    if (!r.decision.ok) cods.push(`${p.tic}:${r.decision.codigo}`);
  }
  console.log(`Emisor sin cola en P1/descarta: ${cods.join(' ')} · fin ${p.fin.tic}`);
  ok(cods[0] === '9:E_SIN_RETX_COLA', 'falta E_SIN_RETX_COLA');
}

console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo bien');
process.exit(fallos ? 1 : 0);

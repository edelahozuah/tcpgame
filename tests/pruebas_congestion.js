// node tests/pruebas_congestion.js  — control de congestión de TCP (AL, EC, RR; Reno y Tahoe).
// Escritas a partir del material de la asignatura (diapositivas GG34-2/GG35-2627, preguntas Wooclap y convenciones
// del curso), no de ninguna implementación. Cada bloque va aislado: un fallo no oculta los demás.
'use strict';
const path = require('path');
const fs = require('fs');
const motor = require('../web/motor.js');
const { CC, Partida, ESCENARIOS, P } = motor;

let fallos = 0;
const ok = (cond, msg) => { if (!cond) { fallos++; console.log('  FALLO:', msg); } };
const cerca = (a, b) => typeof a === 'number' && Math.abs(a - b) < 1e-6;
const bloque = (nombre, fn) => {
  console.log(`# ${nombre}`);
  try { fn(); } catch (e) { fallos++; console.log(`  FALLO: excepción en «${nombre}»: ${e && e.stack ? e.stack.split('\n').slice(0, 3).join(' | ') : e}`); }
};

if (!CC) { fallos++; console.log('CC no está implementado en web/motor.js (se esperaba CC en las exportaciones).'); }
const conCC = (nombre, fn) => (CC ? bloque(nombre, fn) : console.log(`# ${nombre}: omitido (CC no está implementado)`));

/* ---------- Ayudas ---------- */

// Comprueba valor, umbral, modo y texto de un estado de congestión.
function est(e, vc, umbral, modo, texto, msg) {
  ok(cerca(CC.valor(e), vc), `${msg}: VC = ${CC.valor(e)}, esperado ${vc}`);
  ok(cerca(e.umbral, umbral), `${msg}: umbral = ${e.umbral}, esperado ${umbral}`);
  ok(e.modo === modo, `${msg}: modo = ${e.modo}, esperado ${modo}`);
  if (texto !== undefined) ok(CC.texto(e) === texto, `${msg}: texto = «${CC.texto(e)}», esperado «${texto}»`);
}
const crear = (vc, umbral, modo, variante) => CC.crear({ vc, umbral, modo, variante });
// Llega un ACK nuevo por cada elemento de `ks` (segmentos reconocidos por cada uno).
const acks = (e, ...ks) => ks.forEach((k) => CC.ackNuevo(e, k));
// Lleva un estado a RR con duplicados 1, 2 y 3 y comprueba qué devuelve cada uno.
function tresDuplicados(e, msg) {
  ok(CC.ackDuplicado(e, 1) === false, `${msg}: el duplicado 1 no retransmite`);
  ok(CC.ackDuplicado(e, 2) === false, `${msg}: el duplicado 2 no retransmite`);
  ok(CC.ackDuplicado(e, 3) === true, `${msg}: el duplicado 3 retransmite`);
}

// Escenario de congestión: 3 segmentos, búfer 1024, L = 0, sin pérdidas, salvo lo que se pase en `extra`.
const esc = (id, cc, extra) => ({
  id, grupo: 'congestion', nombre: id, L: 0, rto: 12, segmentos: 3, bufer: 1024,
  perdidas: { datos: [], acks: [] }, cc, ...extra,
});
const fotoA = (p, tic) => {
  const h = p.historia.find((x) => x.tic === tic);
  if (!h) throw new Error(`no hay tic ${tic} en la historia (hay ${p.historia.length})`);
  return h.foto.A;
};
// Tics en los que A ve un fin de temporización (primero de ellos) y los segmentos de A retransmitidos.
const ticVence = (p) => { const h = p.historia.find((x) => x.eventos.A.some((e) => e.tipo === 'vence')); return h ? h.tic : null; };
const retxA = (p) => p.registro.filter((s) => s.lado === 'A' && s.retx);
// Secuencia de modos de A, sin repeticiones consecutivas.
const modos = (p) => p.historia.map((h) => h.foto.A.modo).filter((m, i, v) => i === 0 || v[i - 1] !== m);

// A nunca tiene, al enviar un segmento nuevo, tantos segmentos en vuelo como ⌊VC⌋ (envío si vuelo < ⌊VC⌋).
// En el tic t, A conoce lo que B envió hasta el tic t − 1 (lo enviado en t − 1 se ve al empezar t).
function vueloRespetaVC(p, msg) {
  let n = 0;
  for (const s of p.registro.filter((x) => x.lado === 'A' && !x.retx)) {
    const nuevosAntes = p.registro.filter((x) => x.lado === 'A' && !x.retx && x.tic < s.tic).length;
    const an = Math.max(P.SN_A, ...p.registro.filter((x) => x.lado === 'B' && !x.perdido && x.tic < s.tic).map((x) => x.an));
    const vuelo = nuevosAntes - (an - P.SN_A) / P.MSS;
    ok(vuelo < Math.floor(s.vc + 1e-9), `${msg}: tic ${s.tic} envía SN ${s.sn} con ${vuelo} en vuelo y VC = ${s.vc}`);
    ok(cerca(s.vc, fotoA(p, s.tic).vc), `${msg}: tic ${s.tic} el registro dice VC = ${s.vc} y la foto ${fotoA(p, s.tic).vc}`);
    n++;
  }
  ok(n > 0, `${msg}: A no envió nada`);
}

/* =====================================================================
 * 1. Funciones puras sobre el estado de congestión
 * ===================================================================== */

conCC('1.1 Estado inicial, modo por defecto y texto', () => {
  est(crear(1, 64), 1, 64, 'AL', '1', 'VC = 1, umbral 64: AL por defecto');
  est(crear(5, 5), 5, 5, 'EC', '5', 'VC ≥ umbral: EC por defecto');
  est(crear(7, 5), 7, 5, 'EC', '7', 'VC > umbral: EC por defecto');
  est(crear(3, 8, 'EC'), 3, 8, 'EC', '3', 'modo explícito EC');
  est(crear(4.75, 4, 'EC'), 4.75, 4, 'EC', '4 + 3/4', 's.21: 4,75 = 4 + 3/4 en EC se escribe N + c/N');
  est(crear(4.5, 4, 'EC'), 4.5, 4, 'EC', '4 + 2/4', 'EC: 4,5 = 4 + 2/4, sin simplificar');
  est(crear(5.2, 4, 'EC'), 5.2, 4, 'EC', '5 + 1/5', 'EC: 5,2 = 5 + 1/5');
});

conCC('1.2 Diapositiva 14: AL con ACK acumulativo (3 → 5 → 6)', () => {
  const e = crear(3, 64, 'AL');
  CC.ackNuevo(e, 2); est(e, 5, 64, 'AL', '5', 's.14: 2 segmentos asentidos, VC = 3 + 2');
  CC.ackNuevo(e, 1); est(e, 6, 64, 'AL', '6', 's.14: 1 segmento asentido, VC = 5 + 1');
});

conCC('1.3 Diapositiva 19: EC desde VC = 3 (3 → 3 + 2/3 → 4)', () => {
  const e = crear(3, 3, 'EC');
  CC.ackNuevo(e, 2); est(e, 3 + 2 / 3, 3, 'EC', '3 + 2/3', 's.19: 2 segmentos asentidos');
  CC.ackNuevo(e, 1); est(e, 4, 3, 'EC', '4', 's.19: 3 + 3/3 = 4');
});

conCC('1.4 Diapositiva 20: EC desde VC = 4 (4 → 4 + 2/4 → 4 + 3/4)', () => {
  const e = crear(4, 4, 'EC');
  CC.ackNuevo(e, 2); est(e, 4.5, 4, 'EC', '4 + 2/4', 's.20: 2 segmentos asentidos');
  CC.ackNuevo(e, 1); est(e, 4.75, 4, 'EC', '4 + 3/4', 's.20: 1 segmento más');
});

conCC('1.5 Diapositiva 21: EC cambia N dentro de un ACK (4 + 3/4 → 5 → 5 + 1/5 → 5 + 2/5)', () => {
  const e = crear(4.75, 4, 'EC');
  CC.ackNuevo(e, 2); est(e, 5.2, 4, 'EC', '5 + 1/5', 's.21: el primer segmento da 4 + 4/4 = 5 y el segundo 5 + 1/5');
  CC.ackNuevo(e, 1); est(e, 5.4, 4, 'EC', '5 + 2/5', 's.21: 5 + 2/5');
  // Segmento a segmento da lo mismo que en un solo ACK
  const f = crear(4.75, 4, 'EC');
  CC.ackNuevo(f, 1); est(f, 5, 4, 'EC', '5', 's.21: un solo segmento: 4 + 4/4 = 5');
  CC.ackNuevo(f, 1); est(f, 5.2, 4, 'EC', '5 + 1/5', 's.21: ACK de 1 + ACK de 1 = ACK de 2');
});

conCC('1.6 Wooclap GG34 8: AL, VC = 1, 4 RTT sin pérdidas (16)', () => {
  const e = crear(1, 64, 'AL');
  for (let rtt = 1; rtt <= 4; rtt++) { const n = CC.valor(e); for (let i = 0; i < n; i++) CC.ackNuevo(e, 1); }
  est(e, 16, 64, 'AL', '16', 'GG34 8: 1 → 2 → 4 → 8 → 16');
  const f = crear(1, 64, 'AL');
  for (let rtt = 1; rtt <= 4; rtt++) CC.ackNuevo(f, CC.valor(f));   // un ACK acumulativo por RTT
  est(f, 16, 64, 'AL', '16', 'GG34 8 con un ACK acumulativo por RTT');
});

conCC('1.7 Wooclap GG34 9: ACK acumulativo en AL (5)', () => {
  est((() => { const e = crear(3, 8, 'AL'); CC.ackNuevo(e, 2); return e; })(), 5, 8, 'AL', '5', 'GG34 9: VC = 3 + 2 = 5, no 6 ni 3 + 2/3');
});

conCC('1.8 Cruce del umbral por tramos en AL', () => {
  // Ej. del curso: VC = 3, umbral 4, ACK de 2 → 3 + 1 = 4 (= umbral, pasa a EC) y el 2.º segmento cuenta como EC: 4 + 1/4.
  let e = crear(3, 4, 'AL');
  CC.ackNuevo(e, 2); est(e, 4.25, 4, 'EC', '4 + 1/4', 'VC = 3, umbral 4, ACK de 2');
  // No se recorta al umbral: VC = 2, umbral 3, ACK de 2 → 3 y luego 3 + 1/3
  e = crear(2, 3, 'AL');
  CC.ackNuevo(e, 2); est(e, 3 + 1 / 3, 3, 'EC', '3 + 1/3', 'VC = 2, umbral 3, ACK de 2 (no se recorta)');
  // Alcanzar exactamente el umbral con el último segmento del ACK
  e = crear(3, 4, 'AL');
  CC.ackNuevo(e, 1); est(e, 4, 4, 'EC', '4', 'VC = 3, umbral 4, ACK de 1: VC ≥ umbral → EC');
  e = crear(3, 5, 'AL');
  CC.ackNuevo(e, 2); est(e, 5, 5, 'EC', '5', 'VC = 3, umbral 5, ACK de 2: llega justo al umbral');
  // Varios segmentos de EC tras cruzar: VC = 1, umbral 4, ACK de 5 → 2, 3, 4 (EC) y dos segmentos de EC: 4 + 2/4
  e = crear(1, 4, 'AL');
  CC.ackNuevo(e, 5); est(e, 4.5, 4, 'EC', '4 + 2/4', 'VC = 1, umbral 4, ACK de 5');
  // Sin cruzar: se queda en AL
  e = crear(3, 8, 'AL');
  CC.ackNuevo(e, 4); est(e, 7, 8, 'AL', '7', 'VC = 3, umbral 8, ACK de 4: sigue en AL');
});

conCC('1.9 Wooclap GG35 1: ACK acumulativo en EC (4 + 2/4)', () => {
  const e = crear(4, 4, 'EC');
  CC.ackNuevo(e, 2); est(e, 4.5, 4, 'EC', '4 + 2/4', 'GG35 1: ni 4 + 1/4, ni 5, ni 6');
});

conCC('1.10 Wooclap GG35 2: cambia N dentro de un ACK (5 + 1/5)', () => {
  const e = crear(4.75, 4, 'EC');
  CC.ackNuevo(e, 2); est(e, 5.2, 4, 'EC', '5 + 1/5', 'GG35 2: ni 6 + 3/4, ni 5 + 1/4, ni 5 + 2/5');
});

conCC('1.11 Wooclap GG34 10: tres duplicados en AL, Reno (umbral 4, VC 7, RR)', () => {
  const e = crear(8, 16, 'AL');
  CC.ackDuplicado(e, 1); est(e, 8, 16, 'AL', '8', 'GG34 10: duplicado 1, nada cambia');
  CC.ackDuplicado(e, 2); est(e, 8, 16, 'AL', '8', 'GG34 10: duplicado 2, nada cambia');
  ok(CC.ackDuplicado(e, 3) === true, 'GG34 10: el tercer duplicado pide retransmitir');
  est(e, 7, 4, 'RR', '7', 'GG34 10: umbral = 8/2 = 4, VC = 4 + 3 = 7, RR (no 11, no 1)');
});

conCC('1.12 Wooclap GG34 11: vence el temporizador en AL (umbral 4, VC 1, AL)', () => {
  const e = crear(8, 16, 'AL');
  CC.vence(e); est(e, 1, 4, 'AL', '1', 'GG34 11: umbral = 8/2 = 4, VC = 1, AL');
});

conCC('1.13 Wooclap GG35 3: tres duplicados en EC, Reno (umbral 6, VC 9, RR)', () => {
  const e = crear(12, 8, 'EC');
  tresDuplicados(e, 'GG35 3');
  est(e, 9, 6, 'RR', '9', 'GG35 3: umbral = 12/2 = 6, VC = 6 + 3 = 9, RR');
});

conCC('1.14 Wooclap GG35 4: salida de RR (VC = umbral = 6, EC)', () => {
  const e = crear(12, 8, 'EC');
  tresDuplicados(e, 'GG35 4');
  est(e, 9, 6, 'RR', '9', 'GG35 4: punto de partida, RR con umbral 6 y VC 9');
  ok(CC.ackDuplicado(e, 4) === false, 'GG35 4: el duplicado 4 no vuelve a retransmitir');
  est(e, 10, 6, 'RR', '10', 'GG35 4: duplicado 4, VC + 1 en RR');
  ok(CC.ackDuplicado(e, 5) === false, 'GG35 4: el duplicado 5 no retransmite');
  est(e, 11, 6, 'RR', '11', 'GG35 4: duplicado 5, VC + 1 en RR (11 y no 5,5)');
  CC.ackNuevo(e, 1); est(e, 6, 6, 'EC', '6', 'GG35 4: el ACK nuevo da VC = umbral = 6 y EC (no 11, no 1, no 5,5)');
  // El umbral fijado al entrar en RR no cambia, y en EC se sigue con N + c/N
  CC.ackNuevo(e, 1); est(e, 6 + 1 / 6, 6, 'EC', '6 + 1/6', 'GG35 4: ya en EC, el siguiente segmento suma 1/6');
});

conCC('1.15 Salida de RR con umbral fraccionario (2,25)', () => {
  // VC = 4,5 en EC (N = 4, c = 2): umbral = 4,5/2 = 2,25; VC = 2,25 + 3 = 5,25
  const e = crear(4.5, 2, 'EC');
  tresDuplicados(e, 'umbral fraccionario');
  est(e, 5.25, 2.25, 'RR', '5,25', 'RR: umbral = VC/2 = 2,25 y VC = 5,25 (decimal con coma)');
  CC.ackDuplicado(e, 4); est(e, 6.25, 2.25, 'RR', '6,25', 'RR: duplicado 4, +1');
  // ACK nuevo: VC = umbral tal cual, aunque sea fraccionario (N = 2, c = 0,5), modo EC
  CC.ackNuevo(e, 1); est(e, 2.25, 2.25, 'EC', '2,25', 'salida de RR: VC = 2,25 (N = 2, c = 0,5), sin redondear');
  // Cada segmento sigue sumando 1 a c: c = 1,5 → VC = 2 + 1,5/2 = 2,75
  CC.ackNuevo(e, 1); est(e, 2.75, 2.25, 'EC', '2,75', 'tras salir de RR, un segmento más suma 1 a c: 2 + 1,5/2');
});

conCC('1.16 Fin de temporización en cualquier modo', () => {
  let e = crear(8, 16, 'AL');
  CC.vence(e); est(e, 1, 4, 'AL', '1', 'vencimiento en AL');
  e = crear(12, 8, 'EC');
  CC.vence(e); est(e, 1, 6, 'AL', '1', 'vencimiento en EC: umbral = 12/2 = 6, VC = 1, AL');
  e = crear(4.75, 4, 'EC');
  CC.vence(e); est(e, 1, 4.75 / 2, 'AL', '1', 'vencimiento en EC con VC fraccionario: umbral = 4,75/2');
  e = crear(12, 8, 'EC');
  tresDuplicados(e, 'vencimiento en RR');
  CC.ackDuplicado(e, 4);   // VC = 10
  CC.vence(e); est(e, 1, 5, 'AL', '1', 'vencimiento en RR (VC = 10): umbral = 10/2 = 5, VC = 1, AL');
  // También tras un fin de temporización AL suma 1 por segmento reconocido
  e = crear(8, 16, 'AL');
  CC.vence(e);
  CC.ackNuevo(e, 1); est(e, 2, 4, 'AL', '2', 'tras vencer: AL, +1 por segmento reconocido');
  CC.ackNuevo(e, 2); est(e, 4, 4, 'EC', '4', 'tras vencer: ACK de 2 y VC llega al umbral 4 → EC');
});

conCC('1.17 Duplicados 1 y 2 no cambian nada; +1 por duplicado en RR', () => {
  for (const modo of ['AL', 'EC']) {
    const e = crear(8, modo === 'AL' ? 16 : 4, modo);
    const antes = [CC.valor(e), e.umbral, e.modo, CC.texto(e)];
    ok(CC.ackDuplicado(e, 1) === false && CC.ackDuplicado(e, 2) === false, `${modo}: duplicados 1 y 2 devuelven false`);
    ok(cerca(CC.valor(e), antes[0]) && cerca(e.umbral, antes[1]) && e.modo === antes[2] && CC.texto(e) === antes[3], `${modo}: duplicados 1 y 2 no cambian el estado`);
  }
  const e = crear(8, 16, 'AL');
  tresDuplicados(e, '+1 en RR');
  for (let n = 4; n <= 8; n++) {
    ok(CC.ackDuplicado(e, n) === false, `RR: el duplicado ${n} no retransmite`);
    ok(cerca(CC.valor(e), 7 + (n - 3)), `RR: tras el duplicado ${n}, VC = ${CC.valor(e)}, esperado ${7 + (n - 3)}`);
  }
  ok(e.modo === 'RR' && cerca(e.umbral, 4), 'RR: el umbral no cambia con los duplicados');
});

conCC('1.18 Tahoe', () => {
  // Wooclap GG35 5: umbral 8, VC = 12 en EC, 3 duplicados → umbral 6, VC 1, AL
  const e = crear(12, 8, 'EC', 'tahoe');
  ok(CC.ackDuplicado(e, 1) === false && CC.ackDuplicado(e, 2) === false, 'Tahoe: duplicados 1 y 2 no retransmiten');
  est(e, 12, 8, 'EC', '12', 'Tahoe: duplicados 1 y 2 no cambian nada');
  ok(CC.ackDuplicado(e, 3) === true, 'Tahoe: el tercer duplicado retransmite');
  est(e, 1, 6, 'AL', '1', 'GG35 5 (Tahoe): umbral = 12/2 = 6, VC = 1, AL (no RR)');
  ok(CC.ackDuplicado(e, 4) === false, 'Tahoe: el duplicado 4 no retransmite');
  est(e, 1, 6, 'AL', '1', 'Tahoe: los duplicados siguientes no cambian nada');
  CC.ackDuplicado(e, 5); est(e, 1, 6, 'AL', '1', 'Tahoe: duplicado 5, nada');
  // Después, AL desde 1 hasta el nuevo umbral
  for (let i = 0; i < 5; i++) CC.ackNuevo(e, 1);
  est(e, 6, 6, 'EC', '6', 'Tahoe: 1 → 6 en AL y pasa a EC al llegar al umbral 6');
  // En AL, igual
  const f = crear(8, 16, 'AL', 'tahoe');
  tresDuplicados(f, 'Tahoe en AL');
  est(f, 1, 4, 'AL', '1', 'Tahoe en AL: umbral = 4, VC = 1');
  // El vencimiento es igual que en Reno
  const g = crear(12, 8, 'EC', 'tahoe');
  CC.vence(g); est(g, 1, 6, 'AL', '1', 'Tahoe: vencimiento igual que Reno');
});

conCC('1.19 Formas de CC.texto', () => {
  ok(CC.texto(crear(5, 3, 'EC')) === '5', 'entero en EC: «5»');
  ok(CC.texto(crear(5, 64, 'AL')) === '5', 'entero en AL: «5»');
  ok(CC.texto(crear(3 + 2 / 3, 3, 'EC')) === '3 + 2/3', 'EC con fracción: «3 + 2/3»');
  ok(CC.texto(crear(4.75, 4, 'EC')) === '4 + 3/4', 'EC con fracción: «4 + 3/4»');
  ok(CC.texto(crear(4.5, 4, 'EC')) === '4 + 2/4', 'EC con fracción sin simplificar: «4 + 2/4», no «4,5» ni «4 + 1/2»');
  const e = crear(10, 4, 'EC');
  tresDuplicados(e, 'texto en RR');
  ok(CC.texto(e) === '8', `RR con VC entero: «${CC.texto(e)}», esperado «8»`);   // umbral 5, VC 8
  const f = crear(5, 3, 'EC');
  tresDuplicados(f, 'texto en RR');
  ok(CC.texto(f) === '5,5' && cerca(CC.valor(f), 5.5), `RR con VC 5,5: «${CC.texto(f)}», esperado «5,5» (decimal con coma)`);
  const g = crear(4.5, 2, 'EC');
  tresDuplicados(g, 'texto en RR');
  CC.ackNuevo(g, 1);
  ok(CC.texto(g) === '2,25', `c no entero: «${CC.texto(g)}», esperado «2,25»`);
});

/* =====================================================================
 * 2. Partidas completas con Partida.simular
 *
 * Modelo de tiempo: lo enviado en el tic t lo ve el otro al empezar el t + 1; foto.A es el estado de A tras los
 * eventos del tic, antes de enviar. Con 3 segmentos y L = 0: A envía en los tics 1, 2 y 3; B ve el 1.º en el
 * tic 2 (ACK retardado), ve el 2.º en el tic 3 y envía en ese tic un ACK que reconoce los dos (AN = 1152); A lo ve
 * en el tic 4. El 3.º llega a B en el tic 4, B lo reconoce en el tic 5 (AN = 1216) y A lo ve en el tic 6.
 * ===================================================================== */

// Ejemplo de las diapositivas 14, 19, 20 y 21: VC inicial en los tics 1–3, cambios en los tics 4 y 6.
function ejemploDiapositiva(nombre, cc, v4, t4, v6, t6, umbral, modo4, modo6) {
  conCC(nombre, () => {
    const p = Partida.simular(esc(nombre, cc));
    ok(p.fin && p.fin.motivo === 'completo', `${nombre}: fin ${JSON.stringify(p.fin)}`);
    ok(p.par && p.par.fin === 1216, `${nombre}: AN del ACK final ${p.par && p.par.fin}, esperado 1216`);
    const ini = cc.vc;
    for (const t of [1, 2, 3]) {
      const f = fotoA(p, t);
      ok(cerca(f.vc, ini), `${nombre} tic ${t}: VC = ${f.vc}, esperado ${ini} (aún no hay ACK)`);
      ok(f.modo === cc.modo, `${nombre} tic ${t}: modo ${f.modo}`);
      ok(cerca(f.umbral, umbral), `${nombre} tic ${t}: umbral ${f.umbral}`);
    }
    const f4 = fotoA(p, 4), f6 = fotoA(p, 6);
    ok(cerca(f4.vc, v4) && f4.vcTexto === t4, `${nombre} tic 4: VC = ${f4.vc} «${f4.vcTexto}», esperado ${v4} «${t4}»`);
    ok(cerca(f6.vc, v6) && f6.vcTexto === t6, `${nombre} tic 6: VC = ${f6.vc} «${f6.vcTexto}», esperado ${v6} «${t6}»`);
    ok(f4.modo === modo4 && f6.modo === modo6, `${nombre}: modos ${f4.modo}/${f6.modo}, esperados ${modo4}/${modo6}`);
    ok(cerca(f4.umbral, umbral) && cerca(f6.umbral, umbral), `${nombre}: el umbral no debe cambiar (${f4.umbral}, ${f6.umbral})`);
    // Entre los tics 4 y 6 no hay ningún cambio (tic 5: sin eventos para A)
    ok(cerca(fotoA(p, 5).vc, v4), `${nombre} tic 5: VC = ${fotoA(p, 5).vc}, esperado ${v4} (no llega nada a A)`);
    // El tráfico es el de la diapositiva: A envía 1024, 1088 y 1152 en los tics 1, 2 y 3; B envía AN 1152 en el 3 y 1216 en el 5
    const a = p.registro.filter((s) => s.lado === 'A').map((s) => `${s.tic}:${s.sn}`).join(' ');
    const b = p.registro.filter((s) => s.lado === 'B').map((s) => `${s.tic}:${s.an}`).join(' ');
    ok(a === '1:1024 2:1088 3:1152', `${nombre}: segmentos de A «${a}»`);
    ok(b === '3:1152 5:1216', `${nombre}: ACK de B «${b}»`);
    // Cada segmento de A lleva el estado de A en el tic en que lo envía
    for (const s of p.registro.filter((x) => x.lado === 'A')) {
      ok(cerca(s.vc, ini) && s.vcTexto === CC.texto(CC.crear({ vc: ini, umbral, modo: cc.modo })) && s.modo === cc.modo && cerca(s.umbral, umbral),
        `${nombre}: el segmento del tic ${s.tic} lleva vc ${s.vc} «${s.vcTexto}» ${s.modo} umbral ${s.umbral}`);
    }
    vueloRespetaVC(p, nombre);
  });
}
ejemploDiapositiva('S14_AL', { vc: 3, umbral: 64, modo: 'AL' }, 5, '5', 6, '6', 64, 'AL', 'AL');
ejemploDiapositiva('S19_EC', { vc: 3, umbral: 3, modo: 'EC' }, 3 + 2 / 3, '3 + 2/3', 4, '4', 3, 'EC', 'EC');
ejemploDiapositiva('S20_EC', { vc: 4, umbral: 4, modo: 'EC' }, 4.5, '4 + 2/4', 4.75, '4 + 3/4', 4, 'EC', 'EC');
ejemploDiapositiva('S21_EC', { vc: 4.75, umbral: 4, modo: 'EC' }, 5.2, '5 + 1/5', 5.4, '5 + 2/5', 4, 'EC', 'EC');

conCC('2.5 Fichero de 6 segmentos y búfer 256 por defecto', () => {
  const p = Partida.simular({ id: 'D', grupo: 'congestion', nombre: 'D', L: 0, rto: 12, perdidas: { datos: [], acks: [] }, cc: { vc: 8, umbral: 64 } });
  ok(p.fin && p.fin.motivo === 'completo', `fin ${JSON.stringify(p.fin)}`);
  ok(p.par && p.par.fin === 1408, `AN final ${p.par && p.par.fin}, esperado 1408 (6 segmentos)`);
  ok(p.registro.filter((s) => s.lado === 'A' && !s.retx).length === 6, 'A envía 6 segmentos nuevos');
});

bloque('2.6 Sin cc: foto.A.vc === null y la misma traza que antes', () => {
  let ref = null;
  try { ref = JSON.parse(fs.readFileSync(path.join(__dirname, 'trazas_referencia.json'), 'utf8')).apartados; } catch (e) { /* sin referencia */ }
  const mapa = { N1: 'inmediata', N2: 'lenta', N3: 'cero' };
  for (const [id, ap] of Object.entries(mapa)) {
    const p = Partida.simular(id);
    for (const h of p.historia) {
      const f = h.foto.A;
      ok(f.vc === null && f.umbral === null && f.modo === null, `${id} tic ${h.tic}: sin cc, foto.A tiene vc ${f.vc}, umbral ${f.umbral}, modo ${f.modo}`);
    }
    ok(p.historia.length > 0, `${id}: historia vacía`);
    if (ref) {
      const nuestro = p.registro.map((s) => [s.tic, s.lado === 'A' ? 'cliente' : 'servidor', s.sn, s.lado === 'A' ? 2048 : s.an, s.lado === 'B' ? s.w : 512, s.datos].join(' '));
      const exp = ref[ap].segmentos.map((s) => [s.tic, s.lado, s.sn, s.an, s.w, s.datos].join(' '));
      ok(JSON.stringify(nuestro) === JSON.stringify(exp), `${id}: la traza sin cc ya no coincide con la de referencia`);
      ok(p.fin.tic === ESCENARIOS[id].ref && p.fin.motivo === 'completo', `${id}: fin ${JSON.stringify(p.fin)}`);
    }
  }
  // Y los segmentos de A no llevan estado de congestión
  const p = Partida.simular('P1');
  for (const s of p.registro.filter((x) => x.lado === 'A')) ok(s.vc === undefined || s.vc === null, `P1 sin cc: el segmento del tic ${s.tic} lleva vc ${s.vc}`);
});

conCC('2.7 AL desde VC = 1: nunca más segmentos en vuelo que ⌊VC⌋', () => {
  const p = Partida.simular(esc('AL1', { vc: 1, umbral: 64, modo: 'AL' }, { segmentos: 10 }));
  ok(p.fin && p.fin.motivo === 'completo', `fin ${JSON.stringify(p.fin)}`);
  ok(p.par && p.par.fin === 1024 + 10 * 64, `AN final ${p.par && p.par.fin}, esperado 1664`);
  vueloRespetaVC(p, 'AL desde 1');
  ok(cerca(fotoA(p, 1).vc, 1), 'tic 1: VC = 1');
  // Con VC = 1, el segundo segmento no puede salir en el tic 2: no hay ACK todavía
  ok(!p.registro.some((s) => s.lado === 'A' && s.tic === 2), 'AL desde 1: en el tic 2 A no envía (1 en vuelo = ⌊VC⌋)');
  // La VC no baja y sube con cada ACK; no hay pérdidas
  const vcs = p.historia.map((h) => h.foto.A.vc);
  ok(vcs.every((v, i) => i === 0 || v >= vcs[i - 1] - 1e-9), `la VC no debería bajar sin pérdidas: ${vcs.join(' ')}`);
  ok(vcs[vcs.length - 1] > 1, 'la VC ha crecido');
  const d = Partida.simular(esc('AL1b', { vc: 1, umbral: 64, modo: 'AL' }, { segmentos: 10 }));
  ok(JSON.stringify(d.registro) === JSON.stringify(p.registro), 'la simulación es determinista');
});

conCC('2.8 AL → EC al cruzar el umbral (partida)', () => {
  const p = Partida.simular(esc('ALEC', { vc: 1, umbral: 4, modo: 'AL' }, { segmentos: 12 }));
  ok(p.fin && p.fin.motivo === 'completo', `fin ${JSON.stringify(p.fin)}`);
  ok(JSON.stringify(modos(p)) === JSON.stringify(['AL', 'EC']), `secuencia de modos ${modos(p).join(' → ')}, esperada AL → EC`);
  // Una vez en EC, VC ≥ umbral y no baja; el umbral no cambia
  const h = p.historia.filter((x) => x.foto.A.modo === 'EC');
  ok(h.every((x) => x.foto.A.vc >= 4 - 1e-9 && cerca(x.foto.A.umbral, 4)), 'en EC, VC ≥ 4 y umbral = 4');
  ok(p.historia.filter((x) => x.foto.A.modo === 'AL').every((x) => x.foto.A.vc < 4), 'en AL, VC < umbral');
  vueloRespetaVC(p, 'AL→EC');
});

// Pérdida del segundo segmento (SN 1088, 1.er envío) con 8 segmentos y retransmisión rápida.
//
// Razonamiento (L = 0, un segmento por tic y lado, lo enviado en t se ve en t + 1):
//   A envía los segmentos 1, 2, 3… en los tics 1, 2, 3… (VC inicial 7, hay hueco de sobra). El 2.º (SN 1088) se pierde.
//   Tic 2: B ve el 1.º (ACK pendiente). Tic 3: no llega nada (el 2.º se perdió) y el ACK retardado sale: AN = 1088.
//   Tic 4: A ve AN = 1088 (1 segmento nuevo: VC 7 → 8 en AL, o 8 → 8 + 1/8 en EC). Ese mismo tic B ve el 3.º, que
//   llega fuera de orden: ACK duplicado inmediato (AN = 1088). A ve el duplicado 1 en el tic 5; con el 4.º (B lo ve en el 5)
//   el duplicado 2 en el tic 6 y con el 5.º el duplicado 3 en el tic 7. En el tic 7 A retransmite el SN 1088 (retx rápida).
//   Con el 6.º segmento (enviado en el tic 6) llega el duplicado 4 al tic 8. En el tic 8 B ve la retransmisión, rellena el
//   hueco (ACK inmediato, AN = 1408, el 7.º aún no se ha enviado) y A lo ve en el tic 9: ACK nuevo en RR → VC = umbral y EC.
// Caso AL: VC antes del 3.er duplicado = 8 → umbral 4, VC 7, RR; tic 8: VC 8; tic 9: VC = 4, EC.
function perdidaReno(nombre, cc, exacto) {
  const p = Partida.simular(esc(nombre, cc, { segmentos: 8, perdidas: { datos: [{ sn: 1088, envio: 1 }], acks: [] } }));
  ok(p.fin && p.fin.motivo === 'completo', `${nombre}: fin ${JSON.stringify(p.fin)}`);
  ok(p.par && p.par.fin === 1024 + 8 * 64, `${nombre}: AN final ${p.par && p.par.fin}, esperado 1536`);
  const rr = p.historia.filter((h) => h.foto.A.modo === 'RR').map((h) => h.tic);
  ok(rr.length > 0, `${nombre}: A nunca entra en RR`);
  if (!rr.length) return p;
  const td = rr[0];
  const r = retxA(p);
  ok(r.length === 1 && r[0].sn === 1088 && r[0].tic === td, `${nombre}: la retransmisión de 1088 debe salir en el tic ${td} (A ve el 3.er duplicado): ${JSON.stringify(r.map((s) => [s.tic, s.sn]))}`);
  ok(p.historia.find((h) => h.tic === td).eventos.A.some((e) => e.duplicado && e.n === 3), `${nombre}: en el tic ${td} A ve el duplicado 3`);
  ok(p.historia.find((h) => h.tic === td - 1).eventos.A.some((e) => e.duplicado && e.n === 2), `${nombre}: en el tic ${td - 1} A ve el duplicado 2`);
  const antes = fotoA(p, td - 1), en = fotoA(p, td);
  ok(antes.modo !== 'RR', `${nombre}: antes de entrar en RR el modo es ${antes.modo}`);
  ok(cerca(en.umbral, antes.vc / 2), `${nombre}: umbral al entrar en RR ${en.umbral}, esperado ${antes.vc}/2 = ${antes.vc / 2}`);
  ok(cerca(en.vc, antes.vc / 2 + 3), `${nombre}: VC al entrar en RR ${en.vc}, esperado umbral + 3 = ${antes.vc / 2 + 3}`);
  // Mientras dura la RR el umbral no cambia y cada duplicado más suma 1
  const tics = p.historia.filter((h) => h.foto.A.modo === 'RR');
  ok(tics.every((h) => cerca(h.foto.A.umbral, en.umbral)), `${nombre}: el umbral no cambia en RR`);
  for (let i = 1; i < tics.length; i++) {
    const dups = tics[i].eventos.A.filter((e) => e.duplicado).length;
    ok(cerca(tics[i].foto.A.vc, tics[i - 1].foto.A.vc + dups), `${nombre}: tic ${tics[i].tic}: VC ${tics[i].foto.A.vc} tras ${dups} duplicado(s) desde ${tics[i - 1].foto.A.vc}`);
  }
  // Salida: primer tic sin RR; VC = umbral y EC
  const sal = p.historia.find((h) => h.tic > td && h.foto.A.modo !== 'RR');
  ok(!!sal && sal.foto.A.modo === 'EC', `${nombre}: tras la RR el modo debe ser EC (${sal && sal.foto.A.modo})`);
  if (sal) {
    ok(cerca(sal.foto.A.vc, en.umbral) && cerca(sal.foto.A.umbral, en.umbral), `${nombre}: al salir de RR VC = ${sal.foto.A.vc} y umbral = ${sal.foto.A.umbral}, esperados ${en.umbral}`);
    ok(sal.foto.A.vcTexto === CC.texto(CC.crear({ vc: en.umbral, umbral: en.umbral, modo: 'EC' })), `${nombre}: texto «${sal.foto.A.vcTexto}» al salir de RR`);
  }
  if (exacto) {
    ok(td === 7, `${nombre}: la RR empieza en el tic ${td}, esperado 7`);
    ok(cerca(en.umbral, 4) && cerca(en.vc, 7), `${nombre}: tic 7: umbral ${en.umbral} y VC ${en.vc}, esperados 4 y 7`);
    ok(cerca(fotoA(p, 8).vc, 8) && fotoA(p, 8).modo === 'RR', `${nombre}: tic 8: VC ${fotoA(p, 8).vc} ${fotoA(p, 8).modo}, esperados 8 y RR`);
    ok(sal && sal.tic === 9 && cerca(sal.foto.A.vc, 4), `${nombre}: la RR acaba en el tic 9 con VC = 4`);
  }
  vueloRespetaVC(p, nombre);
  return p;
}

conCC('2.9 Pérdida y 3 duplicados, Reno, desde AL: AL → RR → EC', () => {
  const p = perdidaReno('RENO_AL', { vc: 7, umbral: 64, modo: 'AL', variante: 'reno' }, true);
  ok(JSON.stringify(modos(p)) === JSON.stringify(['AL', 'RR', 'EC']), `secuencia de modos ${modos(p).join(' → ')}, esperada AL → RR → EC`);
  ok(cerca(fotoA(p, 4).vc, 8) && fotoA(p, 4).modo === 'AL', 'tic 4: el ACK nuevo de 1 segmento da VC = 8 en AL');
});

conCC('2.10 Pérdida y 3 duplicados, Reno, desde EC: EC → RR → EC', () => {
  // VC = 8 + 1/8 antes del 3.er duplicado: umbral = 4,0625 y VC = 7,0625 (comprobado por propiedad en perdidaReno)
  const p = perdidaReno('RENO_EC', { vc: 8, umbral: 4, modo: 'EC' }, false);
  ok(JSON.stringify(modos(p)) === JSON.stringify(['EC', 'RR', 'EC']), `secuencia de modos ${modos(p).join(' → ')}, esperada EC → RR → EC`);
  ok(fotoA(p, 4).vcTexto === '8 + 1/8', `tic 4: «${fotoA(p, 4).vcTexto}», esperado «8 + 1/8» (ACK nuevo de 1 en EC)`);
});

conCC('2.11 La variante por defecto es Reno', () => {
  const a = Partida.simular(esc('RENO_D', { vc: 7, umbral: 64, modo: 'AL' }, { segmentos: 8, perdidas: { datos: [{ sn: 1088, envio: 1 }], acks: [] } }));
  const b = Partida.simular(esc('RENO_E', { vc: 7, umbral: 64, modo: 'AL', variante: 'reno' }, { segmentos: 8, perdidas: { datos: [{ sn: 1088, envio: 1 }], acks: [] } }));
  ok(JSON.stringify(a.registro) === JSON.stringify(b.registro), 'sin variante = reno');
  ok(modos(a).includes('RR'), 'sin variante entra en RR');
});

conCC('2.12 Pérdida y 3 duplicados, Tahoe: umbral = VC/2, VC = 1, AL, sin RR', () => {
  const p = Partida.simular(esc('TAHOE', { vc: 7, umbral: 64, modo: 'AL', variante: 'tahoe' }, { segmentos: 8, perdidas: { datos: [{ sn: 1088, envio: 1 }], acks: [] } }));
  ok(p.fin && p.fin.motivo === 'completo', `fin ${JSON.stringify(p.fin)}`);
  ok(!p.historia.some((h) => h.foto.A.modo === 'RR'), 'Tahoe nunca entra en RR');
  const r = retxA(p);
  ok(r.length >= 1 && r[0].sn === 1088, 'Tahoe retransmite el 1088');
  if (!r.length) return;
  const td = r[0].tic;   // el tic en que A ve el 3.er duplicado (razonamiento de la prueba 2.9: el tic 7)
  ok(td === 7, `la retransmisión sale en el tic ${td}, esperado 7`);
  ok(p.historia.find((h) => h.tic === td).eventos.A.some((e) => e.duplicado && e.n === 3), 'en ese tic A ve el duplicado 3');
  const antes = fotoA(p, td - 1), en = fotoA(p, td);
  ok(cerca(antes.vc, 8), `antes: VC = ${antes.vc}, esperado 8`);
  ok(en.modo === 'AL' && cerca(en.vc, 1) && en.vcTexto === '1', `en el tic ${td}: ${en.modo} VC ${en.vc} «${en.vcTexto}», esperado AL y VC = 1`);
  ok(cerca(en.umbral, antes.vc / 2), `umbral = ${en.umbral}, esperado ${antes.vc / 2}`);
  // El duplicado 4 (tic 8) no cambia nada
  const f8 = fotoA(p, td + 1);
  ok(f8.modo === 'AL' && cerca(f8.vc, 1) && cerca(f8.umbral, en.umbral), `tic ${td + 1}: ${f8.modo} VC ${f8.vc} umbral ${f8.umbral}, el duplicado 4 no cambia nada`);
  // Con VC = 1 y 5 segmentos en vuelo, A no envía hasta el ACK nuevo
  ok(!p.registro.some((s) => s.lado === 'A' && s.tic === td + 1), `en el tic ${td + 1} A no envía (VC = 1 y hay segmentos en vuelo)`);
  vueloRespetaVC(p, 'Tahoe');
});

// Pérdida del último segmento (SN 1152, 3 segmentos, VC 4, rto 4): no hay duplicados y vence el temporizador.
// Razonamiento: A envía en los tics 1, 2 y 3 (el 3.º se pierde). B ve el 1.º en el 2 y el 2.º en el 3 y envía AN = 1152 en
// el 3. En el tic 4 A ve ese ACK (2 segmentos nuevos: VC 4 → 6 en AL) y el temporizador se reinicia: vence al comienzo del
// tic 4 + rto = 8. En el tic 8 A retransmite el 1152 y aplica umbral = 6/2 = 3, VC = 1, AL. B ve la retransmisión en el 9, la
// reconoce en el 10 (ACK retardado, AN = 1216) y A lo ve en el 11: 1 segmento nuevo en AL → VC = 2.
conCC('2.13 Pérdida y vencimiento: umbral = VC/2, VC = 1, AL', () => {
  const p = Partida.simular(esc('VENCE', { vc: 4, umbral: 64, modo: 'AL' }, { rto: 4, perdidas: { datos: [{ sn: 1152, envio: 1 }], acks: [] } }));
  ok(p.fin && p.fin.motivo === 'completo', `fin ${JSON.stringify(p.fin)}`);
  const tv = ticVence(p);
  ok(tv !== null, 'vence el temporizador');
  if (tv === null) return;
  const r = retxA(p);
  ok(r.length === 1 && r[0].sn === 1152 && r[0].tic === tv, `retransmite el 1152 en el tic del vencimiento (${tv}): ${JSON.stringify(r.map((s) => [s.tic, s.sn]))}`);
  const antes = fotoA(p, tv - 1), en = fotoA(p, tv);
  ok(cerca(antes.vc, 6) && antes.modo === 'AL', `antes del vencimiento: VC = ${antes.vc} ${antes.modo}, esperado 6 AL`);
  ok(cerca(en.umbral, antes.vc / 2), `umbral = ${en.umbral}, esperado ${antes.vc}/2 = 3`);
  ok(en.modo === 'AL' && cerca(en.vc, 1) && en.vcTexto === '1', `en el tic del vencimiento: ${en.modo} VC ${en.vc} «${en.vcTexto}»`);
  ok(tv === 8, `el vencimiento ocurre en el tic ${tv}, esperado 8`);
  // La retransmisión ya lleva el estado nuevo; los segmentos anteriores, el viejo
  const sr = p.registro.find((s) => s.lado === 'A' && s.retx);
  ok(cerca(sr.vc, 1) && sr.modo === 'AL' && cerca(sr.umbral, 3), `el segmento retransmitido lleva VC ${sr.vc}, ${sr.modo}, umbral ${sr.umbral}`);
  // Tras el vencimiento, AL con +1 por segmento reconocido
  const fin = p.historia[p.historia.length - 1];
  ok(cerca(fin.foto.A.vc, 2) && fin.foto.A.modo === 'AL', `al final: VC = ${fin.foto.A.vc} ${fin.foto.A.modo}, esperado 2 AL`);
  vueloRespetaVC(p, 'vencimiento');
});

conCC('2.14 Partida: decisionTCP con causa vc_llena y min{VC, W}', () => {
  const dec = [];
  const p = new Partida(esc('VCLLENA', { vc: 2, umbral: 64, modo: 'AL' }, { segmentos: 6 }), 'A');
  while (p.empezarTic()) { const d = p.decisionTCP('A'); dec.push({ t: p.tic, d }); p.cerrarTic(d.accion, null); }
  const d1 = dec[0].d, d3 = dec.find((x) => x.t === 3).d;
  ok(d1.causa === 'cabe' && d1.accion && d1.accion.sn === 1024, `tic 1: ${d1.causa}`);
  ok(d3.causa === 'vc_llena' && d3.accion === null, `tic 3 (2 en vuelo, VC = 2, cabe en W): causa ${d3.causa}, acción ${JSON.stringify(d3.accion)}`);
  ok(d3.info.vueloSeg === 2 && cerca(d3.info.vc, 2) && d3.info.vcTexto === '2' && d3.info.modo === 'AL' && cerca(d3.info.umbral, 64),
    `tic 3: info ${JSON.stringify({ vueloSeg: d3.info.vueloSeg, vc: d3.info.vc, vcTexto: d3.info.vcTexto, modo: d3.info.modo, umbral: d3.info.umbral })}`);
  // Con una W pequeña (128 B = 2 segmentos) y VC grande, manda la ventana del receptor, no la VC (Wooclap GG34 6: min{VC, VR})
  const dec2 = [];
  const q = new Partida(esc('WLLENA', { vc: 6, umbral: 64, modo: 'AL' }, { bufer: 128 }), 'A');
  while (q.empezarTic() && dec2.length < 3) { const d = q.decisionTCP('A'); dec2.push(d); q.cerrarTic(d.accion, null); }
  ok(dec2[2].causa === 'ventana_llena' && dec2[2].accion === null, `W pequeña, VC = 6, 2 en vuelo: causa ${dec2[2].causa}, no vc_llena`);
});

/* =====================================================================
 * 3. Jugador humano como A
 * ===================================================================== */

const ESCENARIOS_JUGADOR = () => [
  ['S14', esc('S14', { vc: 3, umbral: 64, modo: 'AL' })],
  ['S19', esc('S19', { vc: 3, umbral: 3, modo: 'EC' })],
  ['S20', esc('S20', { vc: 4, umbral: 4, modo: 'EC' })],
  ['S21', esc('S21', { vc: 4.75, umbral: 4, modo: 'EC' })],
  ['AL1', esc('AL1', { vc: 1, umbral: 64, modo: 'AL' }, { segmentos: 10 })],
  ['ALEC', esc('ALEC', { vc: 1, umbral: 4, modo: 'AL' }, { segmentos: 12 })],
  ['RENO_AL', esc('RENO_AL', { vc: 7, umbral: 64, modo: 'AL' }, { segmentos: 8, perdidas: { datos: [{ sn: 1088, envio: 1 }], acks: [] } })],
  ['RENO_EC', esc('RENO_EC', { vc: 8, umbral: 4, modo: 'EC' }, { segmentos: 8, perdidas: { datos: [{ sn: 1088, envio: 1 }], acks: [] } })],
  ['TAHOE', esc('TAHOE', { vc: 7, umbral: 64, modo: 'AL', variante: 'tahoe' }, { segmentos: 8, perdidas: { datos: [{ sn: 1088, envio: 1 }], acks: [] } })],
  ['VENCE', esc('VENCE', { vc: 4, umbral: 64, modo: 'AL' }, { rto: 4, perdidas: { datos: [{ sn: 1152, envio: 1 }], acks: [] } })],
  ['W128', esc('W128', { vc: 6, umbral: 64, modo: 'AL' }, { bufer: 128, segmentos: 6 })],
];
const hojaDe = (f) => ({ ultimoByteEnviado: f.ultimoByteEnviado, ultimoByteReconocido: f.ultimoByteReconocido, ventRecepcion: f.ventRecepcion,
  vc: f.vc, umbral: f.umbral, modo: f.modo });
const campo = (r, nombre) => (r.campos || []).find((c) => c.campo === nombre);

conCC('3.1 Jugador que imita al motor (hoja = foto.A, acción = decisionTCP): todo correcto', () => {
  for (const [id, e] of ESCENARIOS_JUGADOR()) {
    const p = new Partida(e, 'A');
    let n = 0;
    while (p.empezarTic()) {
      const f = p.historia[p.historia.length - 1].foto.A;
      const r = p.cerrarTic(p.decisionTCP('A').accion, hojaDe(f));
      n++;
      ok(r.ok, `${id} tic ${p.tic}: ${JSON.stringify(r.decision)} ${JSON.stringify((r.campos || []).filter((c) => !c.ok))}`);
      for (const k of ['vc', 'umbral', 'modo']) ok(!!campo(r, k), `${id} tic ${p.tic}: falta el campo «${k}» en r.campos`);
    }
    ok(n > 0 && p.fin && p.fin.motivo === 'completo', `${id}: fin ${JSON.stringify(p.fin)}`);
    ok(p.fin.tic === Partida.simular(e).fin.tic, `${id}: imitando al motor acaba en ${p.fin.tic} y simular en ${Partida.simular(e).fin.tic}`);
  }
});

conCC('3.2 Los campos vc y umbral se evalúan por valor (tolerancia 1e-6); modo, por cadena', () => {
  const p = new Partida(esc('S21', { vc: 4.75, umbral: 4, modo: 'EC' }), 'A');
  while (p.empezarTic()) {
    const f = p.historia[p.historia.length - 1].foto.A;
    const h = hojaDe(f);
    if (p.tic === 4) { h.vc = f.vc + 1e-9; h.umbral = f.umbral - 1e-9; }
    const r = p.cerrarTic(p.decisionTCP('A').accion, h);
    ok(r.ok, `tic ${p.tic}: dentro de la tolerancia debe valer (${JSON.stringify(r.campos.filter((c) => !c.ok))})`);
  }
  const q = new Partida(esc('S21', { vc: 4.75, umbral: 4, modo: 'EC' }), 'A');
  const mal = {};
  while (q.empezarTic()) {
    const f = q.historia[q.historia.length - 1].foto.A;
    const h = hojaDe(f);
    if (q.tic === 4) { h.vc = 5; h.modo = 'AL'; }   // 5 + 1/5 escrito como 5 y modo equivocado
    const r = q.cerrarTic(q.decisionTCP('A').accion, h);
    if (q.tic === 4) { mal.r = r; }
  }
  ok(mal.r && !mal.r.ok, 'vc = 5 en lugar de 5 + 1/5 debe fallar');
  ok(mal.r && campo(mal.r, 'vc') && !campo(mal.r, 'vc').ok, 'el campo vc sale mal');
  ok(mal.r && campo(mal.r, 'modo') && !campo(mal.r, 'modo').ok, 'el campo modo sale mal');
  ok(mal.r && campo(mal.r, 'umbral') && campo(mal.r, 'umbral').ok, 'el campo umbral sigue bien');
});

conCC('3.3 Jugador que ignora la VC (envía siempre que cabe en W): E_VC', () => {
  const e = esc('IGNORA', { vc: 1, umbral: 64, modo: 'AL' }, { segmentos: 6 });
  const p = new Partida(e, 'A');
  const cods = [];
  while (p.empezarTic()) {
    const d = p.decisionTCP('A');
    // Envía el siguiente segmento nuevo siempre que cabe en W, aunque supere la VC
    const acc = d.causa === 'vc_llena' ? { sn: p.A.sig, an: P.SN_B, w: P.W_A, datos: P.MSS } : d.accion;
    const r = p.cerrarTic(acc, hojaDe(p.historia[p.historia.length - 1].foto.A));
    if (d.causa === 'vc_llena') {
      ok(!r.ok && r.decision.codigo === 'E_VC', `tic ${p.tic}: enviar con la VC llena da ${r.decision.codigo}, esperado E_VC`);
      ok(typeof r.decision.texto === 'string' && r.decision.texto.length > 0, `tic ${p.tic}: E_VC lleva una explicación`);
    }
    cods.push(r.decision.codigo);
  }
  ok(cods.includes('E_VC'), 'el jugador que ignora la VC recibe E_VC');
  // Y E_VC solo cuando el segmento sí cabía en W: aquí sería E_VENTANA si no cupiera
  const q = new Partida(esc('IGNORA_W', { vc: 6, umbral: 64, modo: 'AL' }, { bufer: 128 }), 'A');
  let visto = false;
  while (q.empezarTic()) {
    const d = q.decisionTCP('A');
    const acc = d.causa === 'ventana_llena' ? { sn: q.A.sig, an: P.SN_B, w: P.W_A, datos: P.MSS } : d.accion;
    const r = q.cerrarTic(acc, null);
    if (d.causa === 'ventana_llena') { visto = true; ok(!r.ok && r.decision.codigo === 'E_VENTANA', `no cabe en W (VC grande): ${r.decision.codigo}, esperado E_VENTANA y no E_VC`); }
  }
  ok(visto, 'se ha dado el caso de ventana llena');
});

conCC('3.4 Jugador que no baja el umbral en la hoja tras un vencimiento: falla el campo umbral', () => {
  const p = new Partida(esc('VENCE', { vc: 4, umbral: 64, modo: 'AL' }, { rto: 4, perdidas: { datos: [{ sn: 1152, envio: 1 }], acks: [] } }), 'A');
  let umbralHoja = 64, fallosUmbral = 0, ticVenc = null;
  while (p.empezarTic()) {
    const h = p.historia[p.historia.length - 1];
    const f = h.foto.A;
    const vence = h.eventos.A.some((x) => x.tipo === 'vence');
    if (vence && ticVenc === null) ticVenc = p.tic;
    const hoja = hojaDe(f);
    hoja.umbral = umbralHoja;   // el jugador sigue anotando el umbral de siempre (64)
    const r = p.cerrarTic(p.decisionTCP('A').accion, hoja);
    const cu = campo(r, 'umbral');
    if (p.tic === ticVenc) {
      ok(cu && !cu.ok && cerca(cu.correcto, 3) && cerca(cu.tuyo, 64), `tic ${p.tic}: campo umbral ${JSON.stringify(cu)}, esperado fallo (correcto 3, tuyo 64)`);
      ok(!r.ok, `tic ${p.tic}: la tarjeta no puede salir ok`);
      ok(campo(r, 'vc') && campo(r, 'vc').ok && campo(r, 'modo').ok, `tic ${p.tic}: vc y modo, bien`);
    }
    if (cu && !cu.ok) fallosUmbral++;
    else if (p.tic < (ticVenc || Infinity)) ok(!!cu && cu.ok, `tic ${p.tic}: antes del vencimiento el umbral es 64`);
  }
  ok(ticVenc !== null && fallosUmbral > 0, 'el umbral desactualizado se detecta');
});

console.log(fallos ? `\n${fallos} fallo(s)` : '\nTodo bien');
process.exit(fallos ? 1 : 0);

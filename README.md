# TCPGame

Juego para aprender el **control de flujo, la transferencia fiable y el control de congestión de TCP** jugando desde dentro de un extremo.
El alumno hace de cliente (emisor) o de servidor (receptor) y decide en cada tic **solo con lo que le ha llegado y lo que tiene apuntado en su hoja**, igual que TCP. Al final ve el diagrama completo y lo compara con lo que creía.

**Jugar:** <https://edelahozuah.github.io/tcpgame/>

Material docente sobre TCP (Kurose y Ross, §3.5.3–3.5.6 y §3.7).

## Qué incluye

- **Escenarios de control de flujo** (N1–N3): la aplicación de B lee al momento, despacio o se duerme.
- **Escenarios con pérdidas** (P1–P5 y al azar): segmentos de datos o ACK perdidos, temporizador, ACK duplicados.
- **Escenarios de control de congestión** (C1–C7): arranque lento, paso a evitación de la congestión, búfer pequeño, y pérdidas con tres ACK duplicados (recuperación rápida) o con vencimiento del temporizador. La hoja de estado añade `VentCongestion`, `umbralAL` y el modo.
- **Opciones de la partida**: retransmisión rápida (tercer ACK duplicado) y qué hace B con lo que llega fuera de orden (lo guarda y A reenvía el más antiguo, o lo descarta y A reenvía toda la cola). Con congestión, la variante **Reno** (recuperación rápida) o **Tahoe**.
- **Corrección** tic a tic (práctica) o al final (evaluación), hoja de estado con las variables de Kurose (`UltimoByteEnviado`, `UltimoByteReconocido`, `VentRecepcion`…) y un resultado final según cómo quedó el fichero en B.
- **La ventana dibujada** (opcional, casilla de la pantalla de inicio): bajo la hoja de estado, una barra con el flujo de octetos pintada solo con lo que el alumno ha apuntado y con los datos de partida. Para A: confirmado, enviado sin confirmar y usable, con los bordes en AN y AN + W (en las cartas de congestión, AN + mín{⌊VC⌋·64, W}). Para B: leído, en el búfer sin leer y el sitio que anuncia, con el final del búfer. No usa el estado real de la partida, así que no corrige nada: si un valor de la hoja está mal, el dibujo sale mal.
- **Reglamento en papel** para jugar en tríos (A, B y árbitro): [`Reglamento_TCPGame.md`](Reglamento_TCPGame.md).

El modelo de tics es el de los ejercicios de la asignatura: un segmento sale al comienzo del tic *t*, llega a mitad del tic *t* y el otro extremo lo tiene en cuenta en el tic *t* + 1.

## Estructura

| Ruta | Contenido |
|---|---|
| `web/` | El juego: página estática sin dependencias (`index.html`, `motor.js`, `juego.js`) |
| `tests/` | Tres pruebas del motor: `node tests/pruebas_motor.js` (contra las soluciones de referencia de los ejercicios y casos de error típicos), `node tests/pruebas_congestion.js` y `node tests/pruebas_doradas_congestion.js` (control de congestión, contra las trazas del simulador de ejercicios). `tests/generar_trazas_congestion.php` regenera esas trazas de referencia con el simulador de ejercicios de la asignatura (la ruta del simulador va como argumento) |
| `Reglamento_TCPGame.md` | Reglas de la versión en papel |

Para probarlo en local basta con servir la carpeta `web/`, por ejemplo `python3 -m http.server -d web 8000` y abrir <http://localhost:8000>.

GitHub Pages se publica con la acción `.github/workflows/pages.yml`, que pasa las pruebas y despliega `web/` en cada push a `main`.

## Licencia

Código bajo licencia [MIT](LICENSE). Reglamento y textos didácticos bajo [CC BY 4.0](LICENSE-reglamento.md).

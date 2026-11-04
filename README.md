# Fútbol en vivo — plugin de Kino

Partidos y canales deportivos dentro de la pestaña **En vivo** de Kino: Champions, Europa
League, La Liga, Premier League, Serie A, Bundesliga, Ligue 1, Liga MX, Brasileirão, Liga
Profesional y el resto de ligas de Sudamérica, más los canales deportivos para cuando no hay
partidos.

## Cómo se instala

1. Abre Kino y entra en **Plugins** (menú ☰ en el teléfono, Ajustes en la TV).
2. Toca **+** y escribe la dirección del repositorio:

   ```
   gregortt1/football-plugin
   ```

3. Acepta e instala. Kino te va a avisar de dos cosas: que agrega canales en vivo a la pestaña
   En vivo, y que puede reproducir canales desde cualquier servidor que indique su lista.

El plugin no está en la tienda de Kino: solo se instala escribiendo esa dirección. Para
actualizarlo, entra en **Plugins ▸ Instalados** y busca la actualización; no hace falta
desinstalar.

## Qué vas a ver

Todo aparece en **En vivo**, en tres filas con el nombre del plugin:

**Partidos en vivo** — solo lo que está jugando ahora (o arranca en los próximos 10 minutos).
Un partido que empieza a las nueve de la noche no aparece acá a las tres de la tarde.

**Canales deportivos** — el directorio completo, siempre disponible. Si no hay partidos a esta
hora, acá hay algo.

**Próximos partidos** — la agenda que todavía no empezó, con la hora delante
(`15:00 · Le Havre vs PSG`) y `mañana` cuando el partido cae después de medianoche. Si lo
abres antes de la hora, Kino te dice a qué hora empieza en vez de abrir una señal muerta.

Los horarios, los equipos y la competición salen de la agenda pública de **ESPN**, no de la
página que emite la señal: un partido aparece solo si ESPN lo tiene, con la hora que ESPN le
da y con los nombres de los dos clubes tal como los nombra ESPN. Las copas juveniles y de
reserva quedan afuera, y también las entradas duplicadas o con un rival que no corresponde.

Las cinco grandes de Europa —Premier League, LaLiga, Serie A, Bundesliga y Ligue 1— con sus
copas (FA Cup, Carabao, Copa del Rey, Coppa Italia, DFB Pokal, Coupe de France), la Champions,
la Europa y la Conference, y del otro lado la Libertadores, la Sudamericana, la Recopa, la Liga
MX, la Liga Profesional, el Brasileirão y las ligas de Colombia, Chile, Perú, Paraguay, Uruguay,
Ecuador, Venezuela y Bolivia.

Solo primera división: Championship, LaLiga 2, Serie B, 2. Bundesliga, Ligue 2, Série B y la
Liga de Expansión MX quedan afuera, igual que las ligas juveniles y de reserva. Las copas que ESPN no publica —Copa Argentina, Copa do Brasil,
Copa Colombia, Copa Chile— siguen apareciendo con los datos del sitio, porque no hay contra qué
cotejarlas. Un partido que ESPN marca aplazado, suspendido o cancelado no se muestra, aunque el
sitio todavía lo tenga en la agenda.

Cada partido lleva el escudo del club local y cada canal lleva su logo. La búsqueda de En vivo
encuentra equipos y canales por nombre, y la guía de TV muestra a qué hora empieza cada partido.

## Los canales, por marca

*Canales deportivos* ya no es una lista larga: cada marca tiene su fila en En vivo —**ESPN, Fox
Sports, DSports, Tigo Sports, DAZN, beIN Sports, TyC Sports y TNT Sports**—, con sus señales de
cada país dentro. El
resto del directorio no se muestra: seis filas con lo que la gente mira rinden más que treinta
canales que nadie abre.

## Canales que la agenda no trae

Además del directorio del sitio, el plugin suma canales deportivos latinos que salen de las
listas públicas de [iptv-org](https://iptv-org.github.io/iptv/): Tigo Sports de Paraguay y de
Honduras, FTV de Bolivia, Deportes TVC, CDN Deportes, ITV Deportes, Teletrak, Turf Móvil, AS3
Sport TV, FIFA+, Real Madrid TV, TNT Sports Premium y beIN SPORTS XTRA en español. Esos vienen con su señal ya
conocida, así que Kino los abre sin pasar por el sitio.

Son señales de terceros: algunas están geobloqueadas fuera de su país y otras se caen sin aviso.
Antes de agregar una se comprobó que estuviera emitiendo, pero eso no lo garantiza para mañana.

Además, para trece canales del directorio que suelen quedarse sin fuente —ESPN y sus señales,
Fox Sports, TyC Sports, TNT Sports, DSports, Movistar Deportes, Sky Sports LaLiga, TUDN— el
plugin guarda una señal de respaldo ya comprobada: si la del sitio no responde, el mismo canal
se abre por ahí. En el peor caso se ve el mismo canal, no una pantalla negra.
## Un acceso por emisora

El mismo partido no se ve igual en todo el continente: un ESPN 2 de Argentina no es el ESPN 2 de
México, y una misma fecha de Champions puede ir por ESPN, ESPN 3 o Fox Sports según el país. Por
eso cada partido aparece **una vez por emisora** que lo transmite, con el nombre del canal:
`Galatasaray vs Stuttgart · ESPN 5`, `Shakhtar vs Sporting CP · ESPN`. Elegís el de tu país y ese
se abre; los demás quedan como respaldo. Se apaga en Configurar si preferís una sola tarjeta por
partido.

## Los dos escudos

En la grilla de En vivo, Kino acepta una sola imagen por canal, así que por defecto el partido
muestra el escudo del equipo local. Si querés los dos, hay un Worker de Cloudflare en
`worker/` que compone los dos escudos en una imagen: se despliega una vez, y su dirección se
pega en **Plugins ▸ Fútbol en vivo ▸ Configurar ▸ Compositor de escudos**. Las instrucciones
están en [`worker/README.md`](worker/README.md). Sin ese ajuste, todo sigue funcionando igual.
## Si el sitio no responde

El plugin vive de un sitio que a veces se cae o bloquea conexiones: cuando eso pasa, *En vivo* y
*Próximos partidos* quedan vacíos en lugar de mostrar un error, y *Canales deportivos* sigue
funcionando con los canales que no dependen de él. Además hay una segunda dirección de la misma
plataforma: si la primera no contesta en cuatro segundos, el plugin sigue por la otra y se queda
con la que respondió.

## Cuando una señal no anda

Si todas las fuentes de un partido fallan, el plugin mira qué canal lo transmite —la misma
etiqueta que muestra el sitio, "ESPN", "Fox Sports", "ESPN 4"— y lo abre por ahí. Solo acepta
el nombre exacto del canal: si el partido dice "ESPN AR" no lo manda a un ESPN de México.

Cada canal tiene una o varias fuentes. El plugin las recorre en orden, saltea las que el propio
sitio ya marca como caídas, y antes de darte una señal comprueba que el manifiesto responda
**y** que el primer fragmento de video exista. Si ninguna responde, Kino te avisa en vez de
dejarte mirando una pantalla negra.

Las fuentes de un partido se piden todas a la vez y gana la primera que realmente emite, así
una que no responde no hace esperar a las demás; y toda la resolución tiene un tope de tiempo,
porque Kino corta la llamada a los veinte segundos. La señal de `ftlly` se busca además en
varios de sus servidores numerados a la vez: alguno tarda once segundos en contestar «no existe»
mientras otro sirve el mismo canal al instante.

Igual pasa: estas señales son de terceros y se caen sin aviso. Si un canal no abre, probá otro
rato o abrí otro canal; no es algo que el plugin pueda arreglar desde acá.

No se listan partidos de fútbol femenino, ni deportes que no son fútbol (pádel, tenis, F1, NBA,
NFL, MLB, MotoGP, boxeo, golf), aunque la agenda del sitio los incluya.

## Si algo no aparece

- **No veo la pestaña En vivo con el plugin**: revisá que la instalación haya terminado y que el
  consentimiento de canales en vivo esté aceptado.
- **Los canales tardan en cambiar**: Kino guarda la lista de canales una hora. Si acaba de
  empezar un partido y todavía no aparece, esperá o reiniciá la app.
- **Kino pide una versión más nueva**: el plugin usa la versión de plugins más reciente de Kino.

Para reportar algo, abrí el plugin en **Plugins ▸ Instalados**, activá **Modo debug** y mandá el
registro junto con el nombre del canal o del partido.

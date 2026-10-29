// Заготовки игр для симуляции LLM. Используются только в демо и тестах, в самом генераторе их нет.
function snakeHtml({ big }) {
  const font = big ? 44 : 22;
  const pad = big ? '22px 48px' : '8px 18px';
  const pad2 = big ? 100 : 56;
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
html,body{margin:0;min-height:100%;background:#0f2a3d;color:#fff;font-family:system-ui,sans-serif;text-align:center}
canvas{display:block;margin:6px auto;background:#1fa85a;border-radius:10px;max-width:96vw}
button{font-size:${font}px;padding:${pad};margin:6px;border:0;border-radius:14px;background:#ffcc33;color:#222;font-weight:700}
#msg{font-size:${font}px;margin:6px}
#pad button{width:${pad2}px;height:${pad2}px;padding:0}
#ui{position:absolute;left:0;right:0;top:120px;background:#0f2a3dcc;padding:20px}
</style></head>
<body><p id="msg">Змейка</p><div id="ui"><button id="start">Старт</button></div>
<canvas id="c" width="360" height="360"></canvas>
<div id="pad"><button data-d="0,-1">▲</button><br><button data-d="-1,0">◀</button><button data-d="1,0">▶</button><br><button data-d="0,1">▼</button></div>
<script>
const c=document.getElementById('c'),x=c.getContext('2d'),N=18,S=20,FOOD=[[8,3],[8,8],[3,8],[3,13],[13,13]];
let snake,dir,food,timer,score;
function reset(){snake=[{x:3,y:3}];dir={x:1,y:0};score=0;food=FOOD[0];document.getElementById('msg').textContent='Счёт: 0 из 5'}
function draw(){x.fillStyle='#1fa85a';x.fillRect(0,0,360,360);x.fillStyle='#ff4d4d';x.beginPath();x.arc(food[0]*S+10,food[1]*S+10,9,0,7);x.fill();x.fillStyle='#fff';snake.forEach(s=>x.fillRect(s.x*S+1,s.y*S+1,S-2,S-2))}
function end(win){clearInterval(timer);document.getElementById('msg').textContent=win?'Победа! Вы собрали все яблоки':'Игра окончена';document.getElementById('start').textContent='Играть снова';document.getElementById('ui').style.display='block'}
function tick(){const h={x:snake[0].x+dir.x,y:snake[0].y+dir.y};if(h.x<0||h.y<0||h.x>=N||h.y>=N||snake.some(s=>s.x==h.x&&s.y==h.y))return end(false);snake.unshift(h);if(h.x==food[0]&&h.y==food[1]){score++;document.getElementById('msg').textContent='Счёт: '+score+' из 5';if(score>=5){draw();return end(true)}food=FOOD[score]}else snake.pop();draw()}
document.getElementById('start').onclick=()=>{reset();document.getElementById('ui').style.display='none';draw();timer=setInterval(tick,${big ? 400 : 320})};
addEventListener('keydown',e=>{const m={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]}[e.key];if(m)dir={x:m[0],y:m[1]}});
document.querySelectorAll('#pad button').forEach(b=>b.onclick=()=>{const [a,d]=b.dataset.d.split(',').map(Number);dir={x:a,y:d}});
</script></body></html>`;
}

module.exports = { snakeHtml };

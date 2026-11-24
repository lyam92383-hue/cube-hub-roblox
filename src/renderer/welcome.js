const $ = (id) => document.getElementById(id);
const hk = await window.cube.invoke('hooks:status');
$('path').textContent = hk.path;
$('preview').textContent = hk.preview;
if (hk.status === 'installed') {
  $('msg').innerHTML = '<span class="ok">Cube Hub est déjà branché.</span>';
  $('plug').textContent = 'Fermer';
  $('plug').onclick = () => window.cube.send('welcome:close');
} else {
  $('plug').onclick = async () => {
    const r = await window.cube.invoke('hooks:install');
    if (!r.ok) {
      $('msg').innerHTML = '<span class="err"></span>';
      $('msg').firstChild.textContent = r.error;
      return;
    }
    $('msg').innerHTML = '<span class="ok">C\'est branché ! Tes prochaines sessions apparaîtront dans le widget.</span>';
    $('plug').textContent = 'C\'est parti';
    $('later').hidden = true;
    $('plug').onclick = () => window.cube.send('welcome:close');
  };
}
$('later').onclick = () => window.cube.send('welcome:close');

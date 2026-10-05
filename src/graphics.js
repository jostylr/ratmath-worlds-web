// Context restoration rebuilds GPU resources while leaving the scene intact.
export function compileProgram(gl, vertex, fragment) {
  const program = gl.createProgram();
  const shaders = [];
  let linked = false;
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, vertex], [gl.FRAGMENT_SHADER, fragment]]) {
      const shader = gl.createShader(type); shaders.push(shader);
      gl.shaderSource(shader, source); gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) { throw new Error(gl.getShaderInfoLog(shader) || 'Shader compilation failed.'); }
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) { throw new Error(gl.getProgramInfoLog(program) || 'Shader linking failed.'); }
    linked = true;
    return program;
  } catch (error) { gl.deleteProgram(program); throw error; }
  finally {
    for (const shader of shaders) {
      if (linked) { gl.detachShader(program, shader); }
      gl.deleteShader(shader);
    }
  }
}

export function manageGraphics(canvas, initialize, invalidate) {
  const controller = { ready: false };
  let notice = null;
  function clearNotice() { notice?.remove(); notice = null; }
  function show(message) {
    clearNotice();
    notice = document.createElement('div'); notice.id = 'graphics-status'; notice.setAttribute('role', 'alert');
    const text = document.createElement('p'); text.textContent = message;
    const retry = document.createElement('button'); retry.textContent = 'Reload page'; retry.addEventListener('click', () => location.reload());
    const back = document.createElement('a'); back.href = 'index.html'; back.textContent = 'All worlds';
    notice.append(text, retry, back); document.body.append(notice);
  }
  function rebuild() {
    controller.ready = false;
    try {
      initialize(); controller.ready = true;
      canvas.dataset.graphics = 'ready';
      clearNotice(); invalidate();
    }
    catch (error) {
      canvas.dataset.graphics = 'failed';
      console.error('Graphics initialization failed:', error);
      show('The picture could not start. Try reloading, or open this page in a browser with WebGL 2 enabled.');
    }
  }
  canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); controller.ready = false;
    canvas.dataset.graphics = 'interrupted';
    show('The graphics connection was interrupted. Your view is kept here; the picture will return when the connection recovers.');
  });
  canvas.addEventListener('webglcontextrestored', rebuild);
  rebuild();
  return controller;
}

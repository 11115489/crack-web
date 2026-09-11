/**
 * 房屋裂缝识别 - 前端逻辑
 * 选图/拍照 -> 压缩 -> Base64 -> POST /api/recognize -> 渲染结果卡片
 */
(function () {
  'use strict';

  // 最大边长（像素），压缩后再上传，减少请求体积
  const MAX_EDGE = 1280;
  const JPEG_QUALITY = 0.85;

  const els = {
    uploadZone: document.getElementById('uploadZone'),
    placeholder: document.getElementById('placeholder'),
    preview: document.getElementById('preview'),
    scanLine: document.getElementById('scanLine'),
    cameraInput: document.getElementById('cameraInput'),
    fileInput: document.getElementById('fileInput'),
    clearBtn: document.getElementById('clearBtn'),
    recognizeBtn: document.getElementById('recognizeBtn'),
    statusText: document.getElementById('statusText'),
    errorTip: document.getElementById('errorTip'),
    loading: document.getElementById('loading'),
    resultCard: document.getElementById('resultCard'),
    resultBadge: document.getElementById('resultBadge'),
    resultTitle: document.getElementById('resultTitle'),
    probRing: document.getElementById('probRing'),
    probValue: document.getElementById('probValue'),
    probHint: document.getElementById('probHint'),
    meterFill: document.getElementById('meterFill'),
    detailHasCrack: document.getElementById('detailHasCrack'),
    detailRisk: document.getElementById('detailRisk'),
    detailAdvice: document.getElementById('detailAdvice'),
  };

  // 当前图片的 Base64（dataURL）
  let currentImageData = null;
  let isBusy = false;

  // ------------------------------------------------------- 工具函数
  function showError(message) {
    els.errorTip.textContent = message;
    els.errorTip.hidden = false;
  }

  function clearError() {
    els.errorTip.textContent = '';
    els.errorTip.hidden = true;
  }

  /**
   * 状态推导（单一数据源：isBusy + currentImageData）
   *   idle      -> 等待上传（页面初始状态）
   *   ready     -> 已选择图片，可开始识别
   *   analyzing -> 分析中…
   */
  function updateStatus() {
    if (!els.statusText) return;

    if (isBusy) {
      els.statusText.textContent = '分析中…';
      els.statusText.className = 'status-pill is-analyzing';
    } else if (currentImageData) {
      els.statusText.textContent = '已选择图片，可开始识别';
      els.statusText.className = 'status-pill is-ready';
    } else {
      els.statusText.textContent = '等待上传';
      els.statusText.className = 'status-pill is-idle';
    }
  }

  /**
   * 切换“分析中”状态。
   * 注意：按钮只在分析中禁用；未选图片时保持可点击，
   * 以便点击后弹出“请先选择图片”提示，而不是静默无反应。
   */
  function setBusy(busy) {
    isBusy = busy;
    els.loading.hidden = !busy;
    els.scanLine.hidden = !busy;
    els.recognizeBtn.disabled = busy;
    els.recognizeBtn.textContent = busy ? '识别中…' : '开始识别';
    updateStatus();
  }

  /** 读取文件并压缩为 dataURL */
  function fileToCompressedDataURL(file) {
    return new Promise((resolve, reject) => {
      if (!file || !/^image\//.test(file.type)) {
        reject(new Error('请选择图片文件（JPG / PNG / WEBP）'));
        return;
      }

      const reader = new FileReader();
      reader.onerror = () => reject(new Error('图片读取失败，请重试'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('图片解析失败，请更换图片'));
        img.onload = () => {
          let { width, height } = img;

          const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
          width = Math.round(width * scale);
          height = Math.round(height * scale);

          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          // 透明底填白，避免 PNG 透明区域变黑
          ctx.fillStyle = '#ffffff';
          ctx.fillRect(0, 0, width, height);
          ctx.drawImage(img, 0, 0, width, height);

          resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  /** 载入图片到预览区 */
  async function handleFile(file) {
    if (!file) return;
    clearError();
    hideResult();

    try {
      const dataURL = await fileToCompressedDataURL(file);
      currentImageData = dataURL;

      els.preview.src = dataURL;
      els.preview.hidden = false;
      els.placeholder.hidden = true;
      els.clearBtn.hidden = false;
      setBusy(false); // 进入“已选择图片，可开始识别”状态，并确保遮罩关闭
    } catch (err) {
      showError(err.message || '图片处理失败');
      updateStatus();
    }
  }

  /** 回到初始状态：等待上传 */
  function resetAll() {
    currentImageData = null;
    els.preview.src = '';
    els.preview.hidden = true;
    els.placeholder.hidden = false;
    els.clearBtn.hidden = true;
    els.fileInput.value = '';
    els.cameraInput.value = '';
    clearError();
    hideResult();
    setBusy(false); // 复位为“等待上传”，同时隐藏加载遮罩与扫描线
  }

  function hideResult() {
    els.resultCard.hidden = true;
    els.resultCard.className = 'card result-card';
    els.meterFill.style.width = '0%';
  }

  // ------------------------------------------------------- 结果渲染
  const ADVICE = {
    高: '存在明显或贯穿性裂缝，建议尽快联系专业结构检测机构现场勘察，必要时采取加固或临时支护措施。',
    中: '存在可见裂缝，建议持续观察裂缝宽度变化，做好标记与拍照记录，如持续扩展请尽快送检。',
    低: '未发现明显裂缝，或仅有极细微表层纹理，可保持常规观察，无需特别处理。',
  };

  function renderResult(data) {
    const { hasCrack, riskLevel, probability } = data;

    // 颜色映射：高=红 / 中=黄 / 低=绿
    const levelClass = { 高: 'level-high', 中: 'level-mid', 低: 'level-low' }[riskLevel] || 'level-low';
    const levelText = { 高: '高风险', 中: '中风险', 低: '低风险' }[riskLevel] || '低风险';

    els.resultCard.hidden = false;
    els.resultCard.className = `card result-card ${levelClass}`;

    els.resultBadge.textContent = levelText;
    els.resultTitle.textContent = hasCrack ? '检测到裂缝' : '未检测到明显裂缝';

    els.probValue.textContent = probability + '%';
    els.probRing.style.background =
      `conic-gradient(var(--accent) ${probability * 3.6}deg, rgba(148, 163, 184, 0.2) 0deg)`;
    els.meterFill.style.width = probability + '%';

    els.probHint.textContent = hasCrack
      ? `模型判断该部位存在裂缝，风险等级：${riskLevel}`
      : '模型判断该部位未见明显裂缝';

    els.detailHasCrack.textContent = hasCrack ? '是' : '否';
    els.detailRisk.textContent = levelText;
    els.detailAdvice.textContent = hasCrack ? ADVICE[riskLevel] : ADVICE.低;

    // 滚动到结果区
    setTimeout(() => {
      els.resultCard.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 120);
  }

  // ------------------------------------------------------- 请求后端
  async function recognize() {
    // 正在分析中：忽略重复点击
    if (isBusy) return;

    // 未选择图片：弹窗提示，直接返回，不进入“分析中”状态
    if (!currentImageData) {
      alert('请先选择图片');
      return;
    }

    clearError();
    setBusy(true);
    hideResult();

    try {
      const resp = await fetch('/api/recognize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: currentImageData }),
      });

      let payload;
      try {
        payload = await resp.json();
      } catch (_) {
        throw new Error(`服务器返回异常（HTTP ${resp.status}）`);
      }

      if (!resp.ok || !payload.success) {
        throw new Error(payload.message || `识别失败（HTTP ${resp.status}）`);
      }

      renderResult(payload.data);
    } catch (err) {
      showError(err.message || '识别失败，请检查网络后重试');
    } finally {
      setBusy(false);
    }
  }

  // ------------------------------------------------------- 事件绑定
  els.uploadZone.addEventListener('click', () => {
    if (!isBusy) els.fileInput.click();
  });

  els.fileInput.addEventListener('change', (e) => handleFile(e.target.files[0]));
  els.cameraInput.addEventListener('change', (e) => handleFile(e.target.files[0]));

  els.clearBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    resetAll();
  });

  els.recognizeBtn.addEventListener('click', recognize);

  // 拖拽上传
  ['dragenter', 'dragover'].forEach((type) => {
    els.uploadZone.addEventListener(type, (e) => {
      e.preventDefault();
      els.uploadZone.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach((type) => {
    els.uploadZone.addEventListener(type, (e) => {
      e.preventDefault();
      els.uploadZone.classList.remove('dragover');
    });
  });

  els.uploadZone.addEventListener('drop', (e) => {
    if (isBusy) return;
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    handleFile(file);
  });

  // 粘贴上传（Ctrl+V）
  document.addEventListener('paste', (e) => {
    if (isBusy) return;
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    for (const item of items) {
      if (item.type && item.type.startsWith('image/')) {
        handleFile(item.getAsFile());
        break;
      }
    }
  });

  // ------------------------------------------------------- 初始化
  // 页面加载后强制复位为初始状态「等待上传」：
  // 隐藏加载遮罩、扫描线与结果卡片，按钮保持可点击。
  resetAll();
})();

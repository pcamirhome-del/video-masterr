import axios from 'axios';

const handleDownloadWithProgress = async (videoUrl, fileName) => {
  let lastTime = Date.now();
  let lastLoaded = 0;

  try {
    const response = await axios({
      url: videoUrl,
      method: 'GET',
      responseType: 'blob', // ضروري لاستقبال الملف كبيانات ثنائية
      onDownloadProgress: (progressEvent) => {
        const { loaded, total } = progressEvent;

        if (total) {
          const percentCompleted = Math.round((loaded * 100) / total);
          // اربط هذا المتغير بـ setProgress الخاص بالمكون
        }

        const loadedMB = (loaded / (1024 * 1024)).toFixed(1);
        // اربط هذا المتغير بـ setDownloadedMB

        const currentTime = Date.now();
        const timeDiff = (currentTime - lastTime) / 1000; 
        if (timeDiff >= 0.5) { 
          const speedBps = (loaded - lastLoaded) / timeDiff;
          const speedMBps = (speedBps / (1024 * 1024)).toFixed(2);
          
          // اربط هذا المتغير بـ setSpeed
          
          lastTime = currentTime;
          lastLoaded = loaded;
        }
      }
    });

    // حفظ الملف في جهاز المستخدم
    const blobUrl = window.URL.createObjectURL(new Blob([response.data]));
    const link = document.createElement('a');
    link.href = blobUrl;
    link.setAttribute('download', fileName || 'video.mp4');
    document.body.appendChild(link);
    link.click();
    
    link.remove();
    window.URL.revokeObjectURL(blobUrl);

  } catch (error) {
    console.error('حدث خطأ أثناء التحميل:', error);
    // اربط هذا بـ setError
  }
};
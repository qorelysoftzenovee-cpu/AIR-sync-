/**
 * AirSync Suite - Offline Transcriber Web Worker
 */

// Import Hugging Face Transformers.js locally as ES module
import * as transformers from './transformers.min.js';

// Configure Transformers.js environment
transformers.env.allowLocalModels = false;

let pipelineInstance = null;
let currentModelName = null;
const fileProgress = {};

/**
 * Handle incoming messages from the main thread
 */
self.onmessage = async (e) => {
  const { type, data } = e.data;

  if (type === 'load') {
    const { modelName } = data;
    
    try {
      // If the model is already loaded, notify ready immediately
      if (pipelineInstance && currentModelName === modelName) {
        self.postMessage({ type: 'ready' });
        return;
      }

      self.postMessage({ type: 'status', data: 'Loading AI model files...' });
      
      // Load speech recognition pipeline
      pipelineInstance = await transformers.pipeline('automatic-speech-recognition', modelName, {
        progress_callback: (progressData) => {
          if (progressData.status === 'downloading' || progressData.status === 'progress') {
            // Track progress per model file
            fileProgress[progressData.file] = {
              loaded: progressData.loaded || 0,
              total: progressData.total || 0,
              progress: progressData.progress || 0
            };
            
            // Sum up loaded and total sizes
            let totalLoaded = 0;
            let totalSize = 0;
            for (const file in fileProgress) {
              totalLoaded += fileProgress[file].loaded;
              totalSize += fileProgress[file].total;
            }
            
            const overallProgress = totalSize > 0 ? Math.round((totalLoaded / totalSize) * 100) : 0;
            
            self.postMessage({
              type: 'progress',
              data: {
                file: progressData.file.split('/').pop(),
                progress: overallProgress,
                loaded: totalLoaded,
                total: totalSize
              }
            });
          }
        }
      });

      currentModelName = modelName;
      self.postMessage({ type: 'ready' });
    } catch (err) {
      console.error('Worker failed to load model:', err);
      self.postMessage({ type: 'error', data: `Failed to load model: ${err.message}` });
    }
  }

  else if (type === 'transcribe') {
    if (!pipelineInstance) {
      self.postMessage({ type: 'error', data: 'Transcriber engine is not initialized.' });
      return;
    }

    const { audio } = data;
    
    try {
      self.postMessage({ type: 'status', data: 'AI Transcribing audio segments...' });

      // Run inference. Use chunking (30s) to support files of any length.
      const startTime = performance.now();
      const result = await pipelineInstance(audio, {
        chunk_length_s: 30,
        stride_length_s: 5,
        return_timestamps: true
      });
      const endTime = performance.now();
      
      console.log(`Transcribed in ${((endTime - startTime) / 1000).toFixed(2)} seconds.`);
      self.postMessage({ type: 'result', data: result });
    } catch (err) {
      console.error('Worker failed to transcribe:', err);
      self.postMessage({ type: 'error', data: `Transcription failed: ${err.message}` });
    }
  }
};

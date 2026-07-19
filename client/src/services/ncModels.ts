/**
 * Registry моделей шумоподавления.
 *
 * Добавление новой модели = новая запись здесь (+ поддержка её moduleId в
 * AudioPipelineWorker). Основная логика сервиса от конкретной модели не зависит.
 */

export type NcModelId = 'deepfilternet3' | 'rnnoise';

export interface NcModelDefinition {
  id: NcModelId;
  label: string;
  /** moduleId для INIT воркера и stages.denoise ворклета. */
  workerModuleId: string;
  /** moduleConfigs[workerModuleId] для INIT/INIT_PIPELINE. */
  moduleConfig: Record<string, unknown>;
}

export const NC_MODELS: Record<NcModelId, NcModelDefinition> = {
  deepfilternet3: {
    id: 'deepfilternet3',
    label: 'DeepFilterNet3',
    workerModuleId: 'deepfilternet',
    moduleConfig: { attenLimDb: 100, postFilterBeta: 0.02 },
  },
  rnnoise: {
    id: 'rnnoise',
    label: 'RNNoise',
    workerModuleId: 'rnnoise',
    moduleConfig: {},
  },
};

export const DEFAULT_NC_MODEL: NcModelId = 'deepfilternet3';

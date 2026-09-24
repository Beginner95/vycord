import { useRef, type ReactNode } from 'react';

/** Скрытый input, ЖИВУЩИЙ в композере: ActionSheet размонтируется сразу после тапа,
 *  а диалог выбора файла отвечает позже — input внутри шторки терял бы change.
 *  `accept` без `capture`: система сама предлагает камеру / галерею / файлы. */
export function useFilePicker(onFiles: (files: FileList) => void): { open(accept: string): void; input: ReactNode } {
  const ref = useRef<HTMLInputElement>(null);
  return {
    open(accept) {
      const el = ref.current;
      if (!el) return;
      el.accept = accept;
      el.value = '';
      el.click();
    },
    input: (
      <input
        ref={ref}
        type="file"
        multiple
        hidden
        className="composer-attach-input"
        onChange={(e) => { if (e.target.files?.length) onFiles(e.target.files); }}
      />
    ),
  };
}

import { MessageSearch, type MessageSearchProps } from '@/components/MessageSearch';
import { useBackDismiss } from '@/mobile/sheets/useBackDismiss';
import './MobileMessageSearch.css';

/** Спека §5.4: поиск по каналу — во весь экран поверх ленты; системное «назад»
 *  закрывает его (запись в истории), а не уводит из чата. */
export function MobileMessageSearch(props: MessageSearchProps) {
  useBackDismiss(true, props.onClose);
  return (
    <div className="chat-search-layer">
      <MessageSearch {...props} />
    </div>
  );
}

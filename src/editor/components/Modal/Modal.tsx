import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import { faTimes } from '@fortawesome/free-solid-svg-icons';

import styles from '../../styles/editor.module.css';

const Modal = ({
  children,
  onClose,
}: {
  children: React.ReactNode;
  onClose: () => void;
}) => {
  return (
    <div className={styles.modal}>
      <button
        className={styles.closeModal}
        onClick={(e) => {
          e.preventDefault();
          onClose();
        }}
      >
        <FontAwesomeIcon icon={faTimes} />
      </button>
      <div className={styles.modalContent}>{children}</div>
    </div>
  );
};

export default Modal;

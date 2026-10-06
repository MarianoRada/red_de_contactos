import Modal from './Modal';

type InfoModalProps = {
  onClose: () => void;
};

export default function InfoModal({ onClose }: InfoModalProps) {
  return (
    <Modal
      title="Una red de contactos se construye con personas, ecosistemas y proyectos que se conectan, colaboran y transforman el mapa a medida que crecen sus vínculos"
      onClose={onClose}
      className="info-modal"
    >
      <div className="info-modal-content">
        <p>
          Este es un texto de ejemplo para presentar información general sobre
          la red. En este espacio se podrá explicar el propósito del mapa, el
          significado de cada nodo y la manera en que las conexiones ayudan a
          descubrir relaciones relevantes entre las distintas entidades.
          También se podrá incluir una breve guía para explorar, seleccionar,
          mover y acercar los nodos dentro de la visualización.
        </p>
      </div>
    </Modal>
  );
}

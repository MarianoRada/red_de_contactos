import type {
  AppData,
  ContactRecord,
  Relationship,
} from '../types/models';

const records: ContactRecord[] = [
  {
    id: 'maria',
    name: 'María Gómez',
    description:
      'Gestora de proyectos y articuladora de iniciativas educativas.',
    email: 'maria@ejemplo.org',
    location: 'Buenos Aires',
    type: 'person',
  },
  {
    id: 'juan',
    name: 'Juan Pérez',
    description:
      'Investigador y consultor en innovación social.',
    email: 'juan@ejemplo.org',
    location: 'Córdoba',
    type: 'person',
  },
  {
    id: 'lucia',
    name: 'Lucía Fernández',
    description:
      'Coordinadora de programas de formación.',
    email: 'lucia@ejemplo.org',
    location: 'Rosario',
    type: 'person',
  },
  {
    id: 'carlos',
    name: 'Carlos Rodríguez',
    description:
      'Especialista en tecnología educativa.',
    email: 'carlos@ejemplo.org',
    location: 'Buenos Aires',
    type: 'person',
  },
  {
    id: 'horizonte',
    name: 'Fundación Horizonte',
    description:
      'Organización dedicada a proyectos educativos y comunitarios.',
    email: 'contacto@horizonte.org',
    location: 'Buenos Aires',
    type: 'institution',
  },
  {
    id: 'universidad',
    name: 'Universidad Nacional',
    description: 'Institución académica.',
    email: 'info@universidad.edu',
    location: 'Córdoba',
    type: 'institution',
  },
  {
    id: 'innovar',
    name: 'Empresa Innovar',
    description:
      'Empresa dedicada al desarrollo de herramientas digitales.',
    email: 'hola@innovar.com',
    location: 'Buenos Aires',
    type: 'company',
  },
  {
    id: 'comunidades',
    name: 'Red Comunidades',
    description:
      'Red de organizaciones y referentes territoriales.',
    email: 'red@comunidades.org',
    location: 'Rosario',
    type: 'institution',
  },
  {
    id: 'educacion',
    name: 'Educación Digital 2026',
    description:
      'Programa de innovación y transformación educativa.',
    type: 'institution',
  },
  {
    id: 'redinnovacion',
    name: 'Red de Innovación',
    description:
      'Iniciativa para conectar organizaciones y referentes.',
    type: 'institution',
  },
  {
    id: 'programa',
    name: 'Programa Comunidades',
    description:
      'Programa de articulación entre organizaciones territoriales.',
    type: 'institution',
  },
];

const r = (
  id: string,
  sourceId: string,
  targetId: string,
  type: Relationship['type']
): Relationship => ({
  id,
  sourceId,
  targetId,
  type,
});

const relationships: Relationship[] = [
  r('r1', 'maria', 'horizonte', 'trabaja en'),
  r('r2', 'maria', 'educacion', 'coordina'),
  r('r3', 'juan', 'universidad', 'colabora con'),
  r('r4', 'juan', 'redinnovacion', 'participa en'),
  r('r5', 'lucia', 'comunidades', 'forma parte de'),
  r('r6', 'lucia', 'programa', 'coordina'),
  r('r7', 'carlos', 'innovar', 'trabaja en'),
  r('r8', 'carlos', 'educacion', 'participa en'),
  r('r9', 'horizonte', 'educacion', 'participa en'),
  r('r10', 'universidad', 'redinnovacion', 'participa en'),
  r('r11', 'innovar', 'educacion', 'colabora con'),
  r('r12', 'comunidades', 'programa', 'coordina'),
  r('r13', 'horizonte', 'comunidades', 'colabora con'),
  r('r14', 'maria', 'lucia', 'colabora con'),
  r('r15', 'juan', 'carlos', 'colabora con'),
];

/*
 * ============================================================
 * DATOS EXTRA PARA PRUEBA DE RENDIMIENTO — 489 NODOS
 * ============================================================
 */

const locations = [
  'Buenos Aires',
  'Córdoba',
  'Rosario',
  'Mendoza',
  'La Plata',
  'Tucumán',
  'Salta',
  'Neuquén',
  'Mar del Plata',
  'Santa Fe',
];

const firstNames = [
  'Sofía',
  'Martín',
  'Valentina',
  'Nicolás',
  'Camila',
  'Federico',
  'Agustina',
  'Tomás',
  'Julieta',
  'Santiago',
];

const lastNames = [
  'García',
  'Martínez',
  'López',
  'Fernández',
  'González',
  'Sánchez',
  'Romero',
  'Díaz',
  'Álvarez',
  'Torres',
];

// ============================================================
// 60 PERSONAS
// ============================================================

for (let i = 1; i <= 60; i++) {
  const firstName =
    firstNames[(i - 1) % firstNames.length];

  const lastName =
    lastNames[(i * 3) % lastNames.length];

  records.push({
    id: `persona-${i}`,
    name: `${firstName} ${lastName} ${i}`,
    description:
      `Profesional vinculado a proyectos, organizaciones y redes de colaboración. Perfil demo ${i}.`,
    email: `persona${i}@ejemplo.org`,
    location: locations[(i - 1) % locations.length],
    type: 'person',
  });
}

// ============================================================
// 20 INSTITUCIONES
// ============================================================

for (let i = 1; i <= 20; i++) {
  records.push({
    id: `institucion-${i}`,
    name: `Institución Demo ${i}`,
    description:
      'Institución dedicada a educación, desarrollo social e innovación.',
    email: `contacto${i}@institucion.org`,
    location: locations[(i * 2) % locations.length],
    type: 'institution',
  });
}

// ============================================================
// 20 EMPRESAS
// ============================================================

for (let i = 1; i <= 20; i++) {
  records.push({
    id: `empresa-${i}`,
    name: `Empresa Demo ${i}`,
    description:
      'Empresa vinculada a tecnología, servicios e innovación.',
    email: `contacto${i}@empresa.com`,
    location: locations[(i * 3) % locations.length],
    type: 'company',
  });
}

/*
 * ============================================================
 * 489 NODOS ADICIONALES
 * ============================================================
 */

// 245 personas adicionales.
for (let i = 1; i <= 245; i++) {
  const firstName =
    firstNames[(i + 4) % firstNames.length];

  const lastName =
    lastNames[(i * 7 + 2) % lastNames.length];

  records.push({
    id: `persona-extra-${i}`,
    name: `${firstName} ${lastName} ${i + 60}`,
    description:
      `Perfil adicional vinculado a proyectos, ecosistemas y redes de colaboracion. Perfil demo ${i + 60}.`,
    email: `persona-extra-${i}@ejemplo.org`,
    location: locations[(i + 4) % locations.length],
    type: 'person',
  });
}

// 122 proyectos adicionales.
for (let i = 1; i <= 122; i++) {
  records.push({
    id: `proyecto-extra-${i}`,
    name: `Proyecto Demo ${i + 20}`,
    description:
      'Proyecto adicional de educacion, desarrollo social e innovacion.',
    email: `proyecto-extra-${i}@ejemplo.org`,
    location: locations[(i * 5) % locations.length],
    type: 'institution',
  });
}

// 122 ecosistemas adicionales.
for (let i = 1; i <= 122; i++) {
  records.push({
    id: `ecosistema-extra-${i}`,
    name: `Ecosistema Demo ${i + 20}`,
    description:
      'Ecosistema adicional vinculado a tecnologia, servicios e innovacion.',
    email: `ecosistema-extra-${i}@ejemplo.org`,
    location: locations[(i * 7) % locations.length],
    type: 'company',
  });
}

/*
 * ============================================================
 * RELACIONES EXTRA
 * ============================================================
 */

// Persona → institución
for (let i = 1; i <= 60; i++) {
  const institutionNumber =
    ((i - 1) % 20) + 1;

  relationships.push(
    r(
      `extra-persona-institucion-${i}`,
      `persona-${i}`,
      `institucion-${institutionNumber}`,
      'participa en'
    )
  );
}

// Persona → empresa
for (let i = 1; i <= 60; i++) {
  const companyNumber =
    ((i * 7) % 20) + 1;

  relationships.push(
    r(
      `extra-persona-empresa-${i}`,
      `persona-${i}`,
      `empresa-${companyNumber}`,
      'colabora con'
    )
  );
}

// Persona → persona
for (let i = 1; i <= 30; i++) {
  relationships.push(
    r(
      `extra-persona-persona-${i}`,
      `persona-${i}`,
      `persona-${i + 30}`,
      'colabora con'
    )
  );
}

// Institución → empresa
for (let i = 1; i <= 20; i++) {
  relationships.push(
    r(
      `extra-institucion-empresa-${i}`,
      `institucion-${i}`,
      `empresa-${i}`,
      'colabora con'
    )
  );
}

/*
 * Relaciones para los 489 nodos adicionales.
 * Cada nodo nuevo queda con entre 0 y 6 vecinos unicos.
 */
const baseRecordIds = records
  .filter((record) => !record.id.includes('-extra-'))
  .map((record) => record.id);

const mockRelationshipTypes: Relationship['type'][] = [
  'colabora con',
  'trabaja en',
  'participa en',
  'forma parte de',
  'coordina',
];

const extraRecordIds = records
  .filter((record) => record.id.includes('-extra-'))
  .map((record) => record.id);

extraRecordIds.forEach((recordId, index) => {
  const connectionCount = (index + 1) % 7;
  const targetIds = new Set<string>();

  for (
    let attempt = 0;
    targetIds.size < connectionCount;
    attempt++
  ) {
    const targetIndex =
      (index * 17 + attempt * 23 + 11) %
      baseRecordIds.length;

    targetIds.add(baseRecordIds[targetIndex]);
  }

  [...targetIds].forEach((targetId, relationIndex) => {
    relationships.push(
      r(
        `extra-node-relation-${index + 1}-${relationIndex + 1}`,
        recordId,
        targetId,
        mockRelationshipTypes[
          (index + relationIndex) % mockRelationshipTypes.length
        ]
      )
    );
  });
});

export const demoData: AppData = {
  records,
  relationships,
};

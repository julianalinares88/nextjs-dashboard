// app/lib/data.ts
import { sql } from '@vercel/postgres';
import { formatCurrency } from './utils'; // si no lo tienes, cámbialo por tu helper

// ------------ Tipos mínimos (borra/ajusta si ya usas ./definitions) ------------
export type Revenue = { month: string; revenue: number };

export type LatestInvoiceRaw = {
  id: string;
  name: string;
  email: string;
  image_url: string | null;
  amount: number; // en centavos si tu schema lo maneja así
};

export type InvoicesTable = {
  id: string;
  amount: number; // centavos
  date: string;   // o Date
  status: 'paid' | 'pending' | 'canceled';
  name: string;
  email: string;
  image_url: string | null;
};

export type InvoiceForm = {
  id: string;
  customer_id: string;
  amount: number; // centavos
  status: 'paid' | 'pending' | 'canceled';
};

export type CustomerField = { id: string; name: string };

export type CustomersTableType = {
  id: string;
  name: string;
  email: string;
  image_url: string | null;
  total_invoices: number;
  total_pending: number; // centavos
  total_paid: number;    // centavos
};
// -----------------------------------------------------------------------------

const ITEMS_PER_PAGE = 6;

// =============== Revenue =================
export async function fetchRevenue() {
  try {
    const { rows } = await sql<Revenue>`SELECT * FROM revenue`;
    return rows;
  } catch (error) {
    console.error('Database Error (fetchRevenue):', error);
    throw new Error('Failed to fetch revenue data.');
  }
}

// =============== Últimas facturas (para cards/listas) =================
export async function fetchLatestInvoices() {
  try {
    const { rows } = await sql<LatestInvoiceRaw>`
      SELECT invoices.amount, customers.name, customers.image_url, customers.email, invoices.id
      FROM invoices
      JOIN customers ON invoices.customer_id = customers.id
      ORDER BY invoices.date DESC
      LIMIT 5
    `;

    return rows.map((invoice:any) => ({
      ...invoice,
      amount: formatCurrency(invoice.amount), // convierte a string amigable
    }));
  } catch (error) {
    console.error('Database Error (fetchLatestInvoices):', error);
    throw new Error('Failed to fetch the latest invoices.');
  }
}

// =============== Datos para tarjetas/resumen =================
export async function fetchCardData() {
  try {
    const invoiceCountPromise = sql<{ count: string }>`SELECT COUNT(*) FROM invoices`;
    const customerCountPromise = sql<{ count: string }>`SELECT COUNT(*) FROM customers`;
    const invoiceStatusPromise = sql<{ paid: number | null; pending: number | null }>`
      SELECT
        SUM(CASE WHEN status = 'paid' THEN amount ELSE 0 END) AS "paid",
        SUM(CASE WHEN status = 'pending' THEN amount ELSE 0 END) AS "pending"
      FROM invoices
    `;

    const [invoiceCountRes, customerCountRes, invoiceStatusRes] = await Promise.all([
      invoiceCountPromise,
      customerCountPromise,
      invoiceStatusPromise,
    ]);

    const numberOfInvoices = Number(invoiceCountRes.rows[0]?.count ?? '0');
    const numberOfCustomers = Number(customerCountRes.rows[0]?.count ?? '0');
    const totalPaidInvoices = formatCurrency(invoiceStatusRes.rows[0]?.paid ?? 0);
    const totalPendingInvoices = formatCurrency(invoiceStatusRes.rows[0]?.pending ?? 0);

    return {
      numberOfCustomers,
      numberOfInvoices,
      totalPaidInvoices,
      totalPendingInvoices,
    };
  } catch (error) {
    console.error('Database Error (fetchCardData):', error);
    throw new Error('Failed to fetch card data.');
  }
}

// =============== Tabla de facturas filtrada + paginación =================
export async function fetchFilteredInvoices(query: string, currentPage: number) {
  const offset = (currentPage - 1) * ITEMS_PER_PAGE;

  try {
    const like = '%' + query + '%';
    const { rows } = await sql<InvoicesTable>`
      SELECT
        invoices.id,
        invoices.amount,
        invoices.date,
        invoices.status,
        customers.name,
        customers.email,
        customers.image_url
      FROM invoices
      JOIN customers ON invoices.customer_id = customers.id
      WHERE
        customers.name ILIKE ${like} OR
        customers.email ILIKE ${like} OR
        invoices.amount::text ILIKE ${like} OR
        invoices.date::text ILIKE ${like} OR
        invoices.status ILIKE ${like}
      ORDER BY invoices.date DESC
      LIMIT ${ITEMS_PER_PAGE} OFFSET ${offset}
    `;

    return rows;
  } catch (error) {
    console.error('Database Error (fetchFilteredInvoices):', error);
    throw new Error('Failed to fetch invoices.');
  }
}

export async function fetchInvoicesPages(query: string) {
  try {
    const like = '%' + query + '%';
    const { rows } = await sql<{ count: string }>`
      SELECT COUNT(*)
      FROM invoices
      JOIN customers ON invoices.customer_id = customers.id
      WHERE
        customers.name ILIKE ${like} OR
        customers.email ILIKE ${like} OR
        invoices.amount::text ILIKE ${like} OR
        invoices.date::text ILIKE ${like} OR
        invoices.status ILIKE ${like}
    `;
    const total = Number(rows[0]?.count ?? 0);
    return Math.ceil(total / ITEMS_PER_PAGE);
  } catch (error) {
    console.error('Database Error (fetchInvoicesPages):', error);
    throw new Error('Failed to fetch total number of invoices.');
  }
}

// =============== CRUD helpers =================
export async function fetchInvoiceById(id: string) {
  try {
    const { rows } = await sql<InvoiceForm>`
      SELECT
        invoices.id,
        invoices.customer_id,
        invoices.amount,
        invoices.status
      FROM invoices
      WHERE invoices.id = ${id}
      LIMIT 1
    `;

    if (!rows[0]) return undefined;

    // Si guardas en centavos y tu UI espera dólares, convierte aquí si lo necesitas.
    const inv = rows[0];
    return { ...inv, amount: inv.amount / 100 };
  } catch (error) {
    console.error('Database Error (fetchInvoiceById):', error);
    throw new Error('Failed to fetch invoice.');
  }
}

export async function fetchCustomers() {
  try {
    const { rows } = await sql<CustomerField>`
      SELECT id, name
      FROM customers
      ORDER BY name ASC
    `;
    return rows;
  } catch (error) {
    console.error('Database Error (fetchCustomers):', error);
    throw new Error('Failed to fetch all customers.');
  }
}

export async function fetchFilteredCustomers(query: string) {
  try {
    const like = '%' + query + '%';
    const { rows } = await sql<CustomersTableType>`
      SELECT
        customers.id,
        customers.name,
        customers.email,
        customers.image_url,
        COUNT(invoices.id) AS total_invoices,
        SUM(CASE WHEN invoices.status = 'pending' THEN invoices.amount ELSE 0 END) AS total_pending,
        SUM(CASE WHEN invoices.status = 'paid' THEN invoices.amount ELSE 0 END) AS total_paid
      FROM customers
      LEFT JOIN invoices ON customers.id = invoices.customer_id
      WHERE
        customers.name ILIKE ${like} OR
        customers.email ILIKE ${like}
      GROUP BY customers.id, customers.name, customers.email, customers.image_url
      ORDER BY customers.name ASC
    `;

    // Formatea montos (si están en centavos) a string para la UI
    return rows.map((c:any) => ({
      ...c,
      total_pending: Number.isFinite(c.total_pending)
        ? (formatCurrency as any)(c.total_pending)
        : (formatCurrency as any)(0),
      total_paid: Number.isFinite(c.total_paid)
        ? (formatCurrency as any)(c.total_paid)
        : (formatCurrency as any)(0),
    })) as unknown as CustomersTableType[];
  } catch (error) {
    console.error('Database Error (fetchFilteredCustomers):', error);
    throw new Error('Failed to fetch customer table.');
  }
}

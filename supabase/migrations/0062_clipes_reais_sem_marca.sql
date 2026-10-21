-- Clipe real sem a marca d'água da DEMO-SLAP: o Jogador escolhe no pedido, e o
-- render sai mais caro (hideWatermark). Pedido antigo fica com a marca.
alter table clipes_reais add column sem_marca boolean not null default false;
